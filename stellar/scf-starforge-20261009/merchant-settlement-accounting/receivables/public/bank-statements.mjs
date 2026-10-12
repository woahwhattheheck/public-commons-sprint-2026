// MIT. Original bank statements and reviewed customer cash posting in the receivables desk.
export function createBankUi(host) {
  const {api, openDialog, mutate, getState, getAsOf, saveBlob, showError, setBusy,
    readSession, saveSession, setMessage, isLocked, render: renderHost} = host;
  const $ = selector => document.querySelector(selector);
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clone = value => structuredClone(value);
  const state = {accounts: [], imports: null, detail: null, page: null, selectedId: readSession('bank.selected',''),
    accountFilter: readSession('bank.account-filter',''), importStatus:'', importSearch:'', importOffset:0,
    view:'rows', rowStatus:'', direction:'', rowSearch:'', rowOffset:0, loading:false, error:'',
    assignments:readSession('bank.assignments',{}), sourceDraft:readSession('bank.source',null),
    editor:readSession('bank.editor',null), inspection:null, inspectionCurrent:false, review:null, generation:0, sourceGeneration:0, dialog:null};
  const methods = ['saveBankAccount','importBankSource','postBankReceipts','ignoreBankRows','restoreBankRows','closeBankImport'];
  const money = (value,currency) => e(currency?.code || '') + ' ' + e(value ?? '—');
  const currencyKey = value => value ? value.code + ':' + value.scale : '';
  const formatStatus = value => String(value || '').replaceAll('_',' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const button = (label,action,attributes='',write=false,primary=false) =>
    '<button type="button" data-action="bank-' + e(action) + '"' + attributes +
    (write?' data-write':'') + (primary?' class="primary"':'') + '>' + e(label) + '</button>';
  const options = (rows,selected,label,describe=row=>row.name||row.reference||row.id) =>
    '<option value="">' + e(label) + '</option>' + rows.map(row =>
      '<option value="' + e(row.id) + '"' + (row.id===selected?' selected':'') + '>' + e(describe(row)) + '</option>').join('');
  const account = id => state.accounts.find(row=>row.id===id);
  const customers = () => getState()?.customers || [];
  const customerName = id => customers().find(row=>row.id===id)?.name || id || 'Choose a customer';
  const currentAssignments = () => state.assignments[state.selectedId] || {};
  const persist = () => {
    saveSession('bank.selected',state.selectedId); saveSession('bank.account-filter',state.accountFilter);
    saveSession('bank.assignments',state.assignments); saveSession('bank.source',state.sourceDraft);
    saveSession('bank.editor',state.editor);
  };
  const label = (title,control,full=false,hint='') => '<label' + (full?' class="full"':'') + '>' +
    e(title) + control + (hint?'<span class="hint">' + e(hint) + '</span>':'') + '</label>';
  const input = (name,value='',attributes='') => '<input name="' + e(name) + '" value="' + e(value) + '"' + attributes + '>';
  const select = (name,values,value,attributes='') => '<select name="' + e(name) + '"' + attributes + '>' +
    values.map(row=>{const pair=Array.isArray(row)?row:[row,row];return '<option value="' + e(pair[0]) + '"' +
      (String(pair[0])===String(value)?' selected':'') + '>' + e(pair[1]) + '</option>';}).join('') + '</select>';
  const actions = (submit,extra='') => '<div class="dialog-actions">' +
    '<button type="button" data-action="close-dialog">Close</button>' + extra +
    (submit?'<button type="submit" class="primary" data-write>' + e(submit) + '</button>':'') + '</div>';
  const status = value => '<span class="status">' + e(formatStatus(value)) + '</span>';
  function lock() { if(isLocked()) { setMessage('Finish the retained operation before starting another change.',true); return true; } return false; }
  async function readAccounts() {
    const rows=[]; let offset=0, total=1, revision;
    while(offset<total) {
      const page=await api.bankAccounts({offset,limit:500});
      if(revision!==undefined && page.revision!==revision) throw new Error('The bank account list changed while loading. Refresh the original workspace.');
      revision=page.revision; total=page.total; rows.push(...page.accounts);
      if(!page.accounts.length && offset<total) throw new Error('The bank account page did not advance. Refresh the workspace.');
      offset+=page.accounts.length;
    }
    return rows;
  }
  async function load({quiet=false}={}) {
    const generation=++state.generation; state.loading=true; state.error='';
    try {
      const [accounts,imports]=await Promise.all([
        readAccounts(),
        api.bankImports({offset:state.importOffset,limit:100,
          ...(state.accountFilter?{accountId:state.accountFilter}:{}),
          ...(state.importStatus?{status:state.importStatus}:{}), ...(state.importSearch?{search:state.importSearch}:{})})
      ]);
      if(generation!==state.generation)return;
      state.accounts=accounts;state.imports=imports;
      if(state.selectedId)await loadDetail({generation});
    } catch(error){ if(generation===state.generation){state.error=String(error.message||error);if(!quiet)showError(error);} }
    finally{if(generation===state.generation){state.loading=false;renderHost();}}
  }
  async function loadDetail({generation=state.generation}={}) {
    if(!state.selectedId){state.detail=null;state.page=null;return;}
    const selected=state.selectedId;
    const value=await api.bankImport(selected,{view:state.view,offset:state.rowOffset,limit:100,
      ...(state.view==='rows'&&state.rowStatus?{rowStatus:state.rowStatus}:{}),
      ...(state.view==='rows'&&state.direction?{direction:state.direction}:{}),
      ...(state.view==='rows'&&state.rowSearch?{search:state.rowSearch}:{})});
    if(generation!==state.generation||selected!==state.selectedId)return;
    state.detail=value;state.page=value;persist();
  }
  function pagination(total,offset,count,action) {
    return '<div class="panel-foot row between"><span class="small-text muted">' +
      (total ? (offset+1)+'–'+(offset+count)+' of '+total : 'No records') + '</span><div class="row">' +
      button('Previous',action,' data-offset="' + Math.max(0,offset-100) + '"' + (offset===0?' disabled':'')) +
      button('Next',action,' data-offset="' + (offset+count) + '"' + (offset+count>=total||!count?' disabled':'')) + '</div></div>';
  }
  function render() {
    const imports=state.imports?.imports||[];
    return '<section class="panel bank-workbench"><div class="panel-head"><div><h2>Bank statements</h2>' +
      '<p class="small-text muted">Retain original statements, match customer payments and review invoice allocations.</p></div><div class="row">' +
      button('Bank accounts','accounts') + button('Import statement','new-import','',true,true) + '</div></div>' +
      '<div class="panel-body"><div class="form-grid three">' +
      label('Bank account','<select data-bank-filter="account">' + options(state.accounts,state.accountFilter,'All accounts',row=>row.reference+' · '+row.name) + '</select>') +
      label('Statement status',select('bankImportStatus',[['','All statements'],['OPEN','Open'],['CLOSED','Closed']],state.importStatus,' data-bank-filter="status"')) +
      '<form id="bank-import-search" class="bank-search"><label>Find a statement' + input('search',state.importSearch,' type="search" maxlength="300"') +
      '</label><button type="submit">Search</button></form></div></div>' +
      (state.error?'<div class="panel-body"><div class="notice error"><p>'+e(state.error)+'</p>'+button('Reload','reload')+'</div></div>':'') +
      (state.loading&&!state.imports?'<div class="panel-body muted">Loading original bank statements…</div>':'') +
      (imports.length?'<div class="table-wrap"><table><thead><tr><th>Statement</th><th>Account</th><th>Status</th><th class="num">Credits to match</th><th class="num">Customer postings</th></tr></thead><tbody>' +
        imports.map(row=>'<tr'+(row.id===state.selectedId?' class="selected"':'')+'><td>' +
          button(row.sourceName,'open-import',' class="link" data-id="'+e(row.id)+'"') +
          '<span class="subline">'+e(row.format)+' · '+e(row.createdAt)+'</span></td><td>'+e(row.accountReference||row.accountName) +
          '<span class="subline">'+e(row.currency?.code)+'</span></td><td>'+status(row.status)+'</td><td class="num">'+e(row.unassignedCount+row.duplicateCount+row.conflictCount) +
          (row.duplicateCount?'<span class="subline">'+e(row.duplicateCount)+' existing payments to link</span>':'')+
          (row.conflictCount?'<span class="subline">'+e(row.conflictCount)+' conflicts</span>':'')+'</td><td class="num">'+
          e(row.postingCount)+'<span class="subline">'+e(row.postedCount)+' posted · '+e(row.linkedCount)+' linked</span></td></tr>').join('') +
        '</tbody></table></div>':'<div class="panel-body"><p>No statements match this selection. Add an account and import its original bank file.</p></div>') +
      pagination(state.imports?.total||0,state.imports?.offset||0,imports.length,'imports-page') + '</section>' +
      (state.detail?renderDetail():'') +
      (Object.keys(currentAssignments()).length?renderSelection():'');
  }
  function renderDetail() {
    const data=state.detail, item=data.bankImport, page=state.page;
    return '<section class="panel bank-detail"><div class="panel-head"><div><h2>'+e(item.sourceName)+'</h2><p class="small-text muted">'+
      e(item.accountReference)+' · '+e(item.accountName)+' · '+e(item.currency.code)+' · '+e(item.rowCount)+' source rows</p></div><div class="row">' +
      button('Original files','files') + (item.status==='CLOSED'?button('Reopen','reopen','',true):button('Close statement','close-import','',true)) +
      '</div></div><div class="panel-body"><div class="row between"><div class="row">'+
      ['rows','postings','history'].map(view=>button(formatStatus(view), 'detail-view',' data-view="'+view+'"'+(state.view===view?' aria-current="page"':''))).join('')+
      '</div><span>'+status(item.status)+'</span></div>'+
      (state.view==='rows'?'<div class="form-grid three bank-row-filters">'+
        label('Row status',select('rowStatus',[['','All rows'],'UNASSIGNED','POSTED','LINKED','IGNORED','DUPLICATE','CONFLICT','SOURCE_ONLY'].map(x=>Array.isArray(x)?x:[x,formatStatus(x)]),state.rowStatus,' data-bank-row-filter="status"'))+
        label('Direction',select('direction',[['','All directions'],['CREDIT','Credits'],['DEBIT','Debits'],['ZERO','Zero']],state.direction,' data-bank-row-filter="direction"'))+
        '<form id="bank-row-search" class="bank-search"><label>Find a transaction'+input('search',state.rowSearch,' type="search" maxlength="300"')+'</label><button type="submit">Search</button></form></div>':'')+
      '</div>'+
      (state.view==='rows'?renderRows(page.items):state.view==='postings'?renderRecords(page.items,'Posting'):renderRecords(page.items,'History'))+
      pagination(page.total,page.offset,page.items.length,'rows-page')+'</section>';
  }
  function renderRows(rows) {
    if(!rows.length)return '<div class="panel-body muted">No source rows match this view.</div>';
    const chosen=currentAssignments(),open=state.detail?.bankImport.status!=='CLOSED';
    return '<div class="table-wrap"><table><thead><tr><th>Bank date</th><th>Original payment</th><th class="num">Amount</th><th>Disposition</th><th>Customer matching</th><th>Actions</th></tr></thead><tbody>'+
      rows.map(row=>'<tr'+(chosen[row.id]?' class="selected"':'')+'><td>'+e(row.bookedDate)+
        (row.valueDate&&row.valueDate!==row.bookedDate?'<span class="subline">Value '+e(row.valueDate)+'</span>':'')+
        '</td><td>'+e(row.reference||row.bankReference||row.transactionId||'Source row '+row.rowNumber)+
        '<span class="subline">'+e(row.counterparty||row.invoiceReference)+'</span></td><td class="num">'+money(row.amount,row.currency)+
        '<span class="subline">'+e(formatStatus(row.kind))+'</span></td><td>'+status(row.status)+
        (row.supersededBy?.length?'<span class="subline">Replaced by a later posted bank source. Open Source for its original correction.</span>':'')+
        (chosen[row.id]?'<span class="subline">'+chosen[row.id].splits.length+' prepared split'+(chosen[row.id].splits.length===1?'':'s')+'</span>':'')+
        '</td><td>'+candidateSummary(row)+'</td><td><div class="row">'+button('Source','row-source',' class="small" data-id="'+e(row.id)+'"')+
        (row.canPost&&open?button(chosen[row.id]?'Edit splits':'Match payment','assign',' class="small" data-id="'+e(row.id)+'"',true):'')+
        (row.status==='IGNORED'&&open?button('Restore','restore-row',' class="small" data-id="'+e(row.id)+'"',true):
          open&&row.kind==='CREDIT'&&['UNASSIGNED','CONFLICT','DUPLICATE'].includes(row.status)?button('Ignore','ignore-row',' class="small" data-id="'+e(row.id)+'"',true):'')+
        '</div></td></tr>').join('')+'</tbody></table></div>';
  }
  function candidateSummary(row) {
    const selected=currentAssignments()[row.id];
    if(selected)return selected.splits.map(split=>'<span class="subline">'+e(customerName(split.customerId||getState()?.receipts?.find(r=>r.id===split.receiptId)?.customerId))+
      ' · '+money(split.amount,row.currency)+'</span>').join('');
    const receipts=row.receiptCandidates||[], invoices=row.invoiceCandidates||[], people=row.customerCandidates||[];
    return (receipts.length?'<span class="subline">'+receipts.length+' possible recorded receipt'+(receipts.length===1?'':'s')+'</span>':'')+
      (invoices.length?'<span class="subline">'+invoices.length+' invoice match'+(invoices.length===1?'':'s')+'</span>':'')+
      (people.length?'<span class="subline">'+people.map(value=>e(value.customer.name)).join(', ')+'</span>':'')||
      '<span class="muted">Choose the customer and invoices.</span>';
  }
  function renderRecords(rows,title) {
    if(!rows.length)return '<div class="panel-body muted">No '+e(title.toLowerCase())+' records.</div>';
    return '<div class="panel-body stack">'+rows.map(row=>'<details><summary>'+e(row.action||row.id||row.requestId||title)+
      (row.at||row.createdAt?' · '+e(row.at||row.createdAt):'')+'</summary><dl class="definition bank-record">'+
      Object.entries(row).filter(([,value])=>value===null||typeof value!=='object').map(([key,value])=>'<dt>'+e(formatStatus(key.replace(/([A-Z])/g,' $1')))+'</dt><dd>'+e(value)+'</dd>').join('')+
      '</dl><details><summary>Complete original record</summary><pre class="bank-json">'+e(JSON.stringify(row,null,2))+'</pre></details></details>').join('')+'</div>';
  }
  function sourceRow(id) { return state.page?.items?.find(row=>row.id===id)||(state.editor?.row?.id===id?state.editor.row:null)||currentAssignments()[id]?.source; }
  function renderRaw(row) {
    const raw=row.raw||{}, fields=raw.fields||{}, columns=state.detail?.columns||state.inspection?.columns||[];
    return '<dl class="definition"><dt>Booked date</dt><dd>'+e(row.bookedDate)+'</dd><dt>Value date</dt><dd>'+e(row.valueDate)+'</dd>'+
      '<dt>Amount</dt><dd>'+money(row.amount,row.currency)+'</dd><dt>Bank reference</dt><dd>'+e(row.bankReference)+'</dd>'+
      '<dt>Transaction</dt><dd>'+e(row.transactionId)+'</dd><dt>Counterparty</dt><dd>'+e(row.counterparty)+'</dd>'+
      '<dt>Invoice reference</dt><dd>'+e(row.invoiceReference)+'</dd><dt>Source row</dt><dd>'+e(row.rowNumber)+' · line '+e(row.lineNumber)+'</dd></dl>'+
      (Object.keys(fields).length?'<div class="table-wrap bank-original"><table><thead><tr><th>Original field</th><th>Original value</th></tr></thead><tbody>'+
        Object.entries(fields).map(([key,value])=>'<tr><td>'+e(key)+'</td><td class="preline">'+e(typeof value==='object'?JSON.stringify(value):value)+'</td></tr>').join('')+'</tbody></table></div>':'')+
      (raw.values?.length?'<div class="table-wrap bank-original"><table><thead><tr><th>Original CSV column</th><th>Original value</th></tr></thead><tbody>'+
        raw.values.map((value,index)=>'<tr><td>'+e(columns[index]||'Column '+(index+1))+'</td><td class="preline">'+e(value)+'</td></tr>').join('')+'</tbody></table></div>':'')+
      (raw.text?'<pre class="bank-json">'+e(raw.text)+'</pre>':'')+
      (row.sourceIssues?.length?'<h3 class="section">Source findings</h3>'+renderRecords(row.sourceIssues.map(item=>typeof item==='string'?{code:item}:item),'Source finding'):'')+
      '<details class="bank-original"><summary>Complete original source row</summary><pre class="bank-json">'+e(JSON.stringify(row,null,2))+'</pre></details>'+
      '<details class="bank-original"><summary>Original source identity</summary><p class="mono">'+e(row.sourceRowSha256)+'</p></details>'+
      (row.supersededBy?.length?'<h3 class="section">Posted source replacements</h3>'+renderRecords(row.supersededBy,'Source replacement'):'')+
      (row.sourceMatches?.length?'<h3 class="section">Other retained source matches</h3>'+renderRecords(row.sourceMatches,'Source match'):'');
  }


  function accountsDialog() {
    state.dialog='accounts';
    openDialog('Bank accounts','<p>These records identify original statement sources and their customer-payment currency.</p>'+
      '<div class="table-wrap"><table><thead><tr><th>Account</th><th>Currency</th><th>Statement identity</th><th>Status</th><th></th></tr></thead><tbody>'+
      state.accounts.map(row=>'<tr><td>'+e(row.reference)+'<span class="subline">'+e(row.name)+'</span></td><td>'+e(row.currency.code)+' · '+e(row.currency.scale)+
        ' decimals</td><td>'+e(row.bankId)+'<span class="subline">'+e(row.accountReference)+'</span></td><td>'+status(row.status)+'</td><td>'+
        button('Edit','edit-account',' class="small" data-id="'+e(row.id)+'"',true)+'</td></tr>').join('')+'</tbody></table></div>'+
      actions(null,button('Add bank account','add-account','',true,true)));
  }
  function accountDialog(value=null,{returnToSource=false}={}) {
    state.accountDraft=clone(value||{reference:'',name:'',currency:{code:state.inspection?.sections?.find(s=>s.id===state.sourceDraft?.sectionId)?.currencyCode||'USD',scale:2},
      method:'Bank transfer',bankId:'',accountReference:'',status:'ACTIVE'});
    state.returnToSource=returnToSource;state.dialog='account';
    const item=state.accountDraft;
    openDialog(item.id?'Edit bank account':'Add bank account','<form id="bank-account-form"><div class="form-grid">'+
      label('Account reference',input('reference',item.reference,' maxlength="80" required'))+
      label('Account name',input('name',item.name,' maxlength="200" required'))+
      label('Currency',input('currencyCode',item.currency.code,' maxlength="3" pattern="[A-Za-z]{3}" required'))+
      label('Decimal places',select('currencyScale',[0,1,2,3,4,5,6],item.currency.scale))+
      label('Payment method',input('method',item.method,' maxlength="100" required'))+
      label('Status',select('status',['ACTIVE','ARCHIVED'],item.status))+
      label('Bank identity from statement',input('bankId',item.bankId,' maxlength="200"'))+
      label('Original account identity',input('accountReference',item.accountReference,' maxlength="200"'))+
      '</div><p class="hint bank-original">Currency and original bank/account identity are retained with imported statements. The account name and reference identify this source in the desk.</p>'+
      actions('Save bank account')+'</form>');
  }
  function emptyLayout() {
    return {delimiter:',',dateFormat:'YYYY-MM-DD',decimalMark:'.',groupSeparator:'',amountMode:'SIGNED',creditSign:'POSITIVE',columns:{}};
  }
  function readLayout(form) {
    const get=name=>form.elements.namedItem(name)?.value;
    const layout={delimiter:get('csvDelimiter')||',',dateFormat:get('csvDateFormat')||'YYYY-MM-DD',
      decimalMark:get('csvDecimalMark')||'.',groupSeparator:get('csvGroupSeparator')||'',
      amountMode:get('csvAmountMode')||'SIGNED',creditSign:get('csvCreditSign')||'POSITIVE',columns:{}};
    const fields=['date','transactionId','reference','counterparty','invoiceReference','valueDate','balance',
      ...(layout.amountMode==='CREDIT_DEBIT'?['credit','debit']:['amount'])];
    for(const name of fields){const value=get('bankColumn_'+name);if(value)layout.columns[name]=value;}
    return layout;
  }
  function csvLayoutForm(layout,columns) {
    const fields=[['date','Booked date',true],...(layout.amountMode==='CREDIT_DEBIT'
      ?[['credit','Credit amount',true],['debit','Debit amount',true]]:[['amount','Signed amount',true]]),
      ['transactionId','Bank transaction ID'],['reference','Payment reference'],['counterparty','Counterparty'],
      ['invoiceReference','Invoice reference'],['valueDate','Value date'],['balance','Running balance']];
    const controls='<div class="form-grid three">'+
      label('Delimiter',select('csvDelimiter',[[',','Comma'],[';','Semicolon'],['\t','Tab']],layout.delimiter))+
      label('Date format',select('csvDateFormat',['YYYY-MM-DD','DD/MM/YYYY','MM/DD/YYYY','YYYYMMDD'],layout.dateFormat))+
      label('Amount columns',select('csvAmountMode',[['SIGNED','One signed amount'],['CREDIT_DEBIT','Separate credit and debit']],layout.amountMode))+
      label('Decimal mark',select('csvDecimalMark',[['.','Period'],[',','Comma']],layout.decimalMark))+
      label('Digit grouping',select('csvGroupSeparator',[['','No grouping'],[',','Comma'],['.','Period'],[' ','Space']],layout.groupSeparator))+
      label('Signed credits are',select('csvCreditSign',[['POSITIVE','Positive'],['NEGATIVE','Negative']],layout.creditSign,
        layout.amountMode==='CREDIT_DEBIT'?' disabled':''))+'</div>';
    return '<section class="section"><h3>CSV layout</h3>'+controls+
      (columns.length?'<div class="form-grid three bank-original">'+fields.map(([name,title,required])=>label(title,
        '<select name="bankColumn_'+name+'"><option value="">'+(required?'Choose the original column':'Not present')+'</option>'+
        columns.map(column=>'<option value="'+e(column)+'"'+(layout.columns?.[name]===column?' selected':'')+'>'+e(column)+'</option>').join('')+
        '</select>',false,required?'Required for this statement layout':'')).join('')+'</div>':
        '<p class="hint bank-original">Inspect the original file to read its actual column names, then select the date and amount columns.</p>')+'</section>';
  }
  function captureSourceForm() {
    const form=$('#bank-source-form');if(!form)return;
    const draft=state.sourceDraft||{};
    draft.accountId=form.elements.accountId.value;draft.format=form.elements.format.value;
    draft.sectionId=form.elements.sectionId?.value||'';
    if(draft.format==='CSV')draft.csvLayout=readLayout(form);
    captureParserOptions(form,draft);
    state.sourceDraft=draft;persist();
  }
  function sourcePayload() {
    const draft=state.sourceDraft;
    if(!draft?.file?.dataBase64)throw new Error('Choose the original statement file.');
    const value={format:draft.format,file:clone(draft.file),
      ...(draft.accountId?{accountId:draft.accountId}:{}),...(draft.sectionId?{sectionId:draft.sectionId}:{})};
    if(draft.format==='CSV')value.csvLayout=clone(draft.csvLayout||emptyLayout());
    applyParserOptions(value,draft);
    return value;
  }
  function sourceDialog() {
    state.dialog='source';
    state.sourceDraft ||= {accountId:state.accountFilter||'',format:'CSV',sectionId:'',csvLayout:emptyLayout(),file:null};
    const draft=state.sourceDraft,inspection=state.inspection,sections=inspection?.sections||[];
    const selectedAccount=account(draft.accountId),columns=inspection?.columns||[];
    const layout=draft.csvLayout||selectedAccount?.csvLayout||emptyLayout();
    openDialog('Import original bank statement','<form id="bank-source-form"><div class="form-grid">'+
      label('Bank account','<select name="accountId">'+options(state.accounts.filter(row=>row.status==='ACTIVE'),draft.accountId,
        'Choose the original bank account',row=>row.reference+' · '+row.name+' · '+row.currency.code)+'</select>')+
      label('Statement format',select('format',[['CSV','CSV'],['OFX','OFX / QFX'],['MT940','MT940']],draft.format))+
      label('Original statement file','<input name="sourceFile" type="file" accept=".csv,.ofx,.qfx,.mt940,.940,.sta,.txt" data-bank-source-file>',
        true,'Up to 1,000,000 bytes and 5,000 statement rows. Original file bytes and bank transaction identities are retained.')+
      (draft.file?'<div class="full small-text"><strong>'+e(draft.file.name)+'</strong> · '+e(draft.fileBytes)+' bytes</div>':'')+
      (sections.length?label('Original statement section','<select name="sectionId"><option value="">Choose the statement section</option>'+
        sections.map(section=>'<option value="'+e(section.id)+'"'+(draft.sectionId===section.id?' selected':'')+'>'+
          e((section.bankId?section.bankId+' · ':'')+(section.accountReference||section.id)+' · '+(section.currencyCode||'')+' · '+
            (section.from||'')+'–'+(section.until||'')+' · '+section.rowCount+' rows')+'</option>').join('')+'</select>',true):'')+
      '</div>'+(draft.format==='CSV'?csvLayoutForm(layout,columns):parserOptionsForm(draft))+
      '<div class="row bank-original">'+button('Inspect original file','inspect-source','',false,true)+
        button('Add bank account','source-add-account','',true)+'</div>'+
      (inspection?(state.inspectionCurrent?'':'<p class="notice bank-original" data-bank-source-stale>The source selection or layout changed. Inspect it again before retaining the statement.</p>')+renderInspection(inspection):'<p class="hint bank-original">Inspection reads the selected original statement. Save the import after checking its source, account, dates, currency and layout.</p>')+
      actions(inspection&&state.inspectionCurrent&&!inspection.requiresLayout&&draft.accountId&&draft.sectionId?'Retain statement':null)+'</form>');
  }
  function statementBalance(value) { return value?e(value.amount)+' · '+e(value.date):'Not supplied'; }
  function renderInspection(value) {
    const section=value.sections.find(row=>row.id===value.sectionId);
    return '<section class="section"><h3>Original statement review</h3><dl class="definition"><dt>Source file</dt><dd>'+e(value.source.name)+'</dd>'+
      '<dt>File size</dt><dd>'+e(value.source.bytes)+' bytes</dd><dt>Source format</dt><dd>'+e(value.source.format)+'</dd>'+
      (section?'<dt>Statement dates</dt><dd>'+e(section.from)+'–'+e(section.until)+'</dd><dt>Source currency</dt><dd>'+e(section.currencyCode)+
        '</dd><dt>Bank account</dt><dd>'+e(section.bankId)+' · '+e(section.accountReference)+'</dd><dt>Rows</dt><dd>'+e(section.rowCount)+
        ' · '+e(section.creditCount)+' credits · '+e(section.debitCount)+' debits</dd><dt>Opening balance</dt><dd>'+statementBalance(section.openingBalance)+
        '</dd><dt>Closing balance</dt><dd>'+statementBalance(section.closingBalance)+'</dd>':'')+'</dl>'+
      (section?.balanceSnapshots?.length?'<details class="bank-original"><summary>All original balance snapshots</summary>'+renderRecords(section.balanceSnapshots,'Balance snapshot')+'</details>':'')+
      (value.requiresLayout?'<p class="notice bank-original">Select the original CSV date and amount columns, then inspect the complete layout.</p>':'')+
      (value.issues?.length?'<div class="bank-original"><h4>Source observations</h4><ul>'+value.issues.map(issue=>'<li>'+
        e(typeof issue==='string'?issue.message||issue:String(issue.message||issue.code||JSON.stringify(issue)))+'</li>').join('')+'</ul></div>':'')+
      renderSampleRows(value.rows?.items||[],value.columns||[])+
      '<details class="bank-original"><summary>Original source identity</summary><p class="mono">'+e(value.source.sha256)+'</p></details></section>';
  }
  function renderSampleRows(rows,columns) {
    if(!rows.length)return '';
    const heads=columns.length?columns:['Booked date','Amount','Reference','Counterparty'];
    return '<div class="table-wrap bank-original"><table><thead><tr>'+heads.map(name=>'<th>'+e(name)+'</th>').join('')+
      '</tr></thead><tbody>'+rows.map(row=>{
        const values=columns.length?(Array.isArray(row.raw?.values)?row.raw.values:Array.isArray(row.values)?row.values:
          columns.map(key=>row.raw?.fields?.[key]??row.fields?.[key]??'')):
          [row.bookedDate,row.amount,row.reference||row.bankReference,row.counterparty];
        return '<tr>'+heads.map((_,i)=>'<td class="preline">'+e(values[i])+'</td>').join('')+'</tr>';
      }).join('')+'</tbody></table></div><p class="hint bank-original">Showing '+rows.length+' original sample rows. The retained import includes the complete statement.</p>';
  }
  async function chooseSourceFile(file) {
    if(!file)return;
    if(file.size>1000000)throw new Error('This statement exceeds the original 1,000,000-byte intake limit. Choose an original statement export within that size.');
    if(!file.size)throw new Error('Choose a statement file containing the original transactions.');
    if(file.name.length>240)throw new Error('The statement filename must be at most 240 characters.');
    const generation=++state.sourceGeneration;const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    if(generation!==state.sourceGeneration)return;
    const draft=state.sourceDraft||{accountId:'',format:'CSV',sectionId:'',csvLayout:emptyLayout()};
    draft.file={name:file.name,dataBase64:btoa(binary)};draft.fileBytes=bytes.length;draft.sectionId='';
    const extension=file.name.split('.').at(-1).toLowerCase();
    if(['ofx','qfx'].includes(extension))draft.format='OFX';
    else if(['mt940','940','sta'].includes(extension))draft.format='MT940';
    else if(extension==='csv')draft.format='CSV';
    state.sourceDraft=draft;state.inspection=null;state.inspectionCurrent=false;persist();if(state.dialog==='source')sourceDialog();
  }
  async function inspectSource() {
    captureSourceForm();const payload=sourcePayload(),generation=state.sourceGeneration;setBusy(true);
    try {
      const value=await api.inspectBankSource(payload);
      if(generation!==state.sourceGeneration)return;
      state.inspection=value;state.inspectionCurrent=true;
      if(value.sectionId)state.sourceDraft.sectionId=value.sectionId;
      else if(value.sections.length===1)state.sourceDraft.sectionId=value.sections[0].id;
      if(value.layout)state.sourceDraft.csvLayout=clone(value.layout);
      state.inspectionKey=JSON.stringify(sourcePayload());
      persist();if(state.dialog==='source')sourceDialog();
    } finally {setBusy(false);}
  }


  function newSplit(row,{action='CREATE',receipt=null,customerId=''}={}) {
    return {key:crypto.randomUUID(),action,customerId:customerId||receipt?.customerId||'',receiptId:receipt?.id||'',coverageKey:'',
      amount:receipt?.amount||row.amount,allocations:[],residualAllocations:[],effectiveDate:action==='LINK'?(receipt?.accountingDate||receipt?.receivedDate||row.bookedDate):action==='CORRECT'?getAsOf():row.bookedDate,
      reason:'',dateDifferenceReason:'',funds:null};
  }
  function allReceipts(row) {
    const map=new Map(), candidates=row.receiptCandidates||[],
      dated=state.editor?.row.id===row.id?state.editor.splits.flatMap(split=>[...(split.funds?.receipts||[]),...(split.residualFunds?.receipts||[])]):[];
    for(const item of [...(getState()?.receipts||[]),...candidates.map(value=>value.receipt),...dated])
      if(item?.id && item.status!=='VOID' && currencyKey(item.currency)===currencyKey(row.currency))map.set(item.id,item);
    const rank=new Map(candidates.map((value,index)=>[value.receipt.id,index]));
    return [...map.values()].sort((a,b)=>(rank.get(a.id)??Number.MAX_SAFE_INTEGER)-(rank.get(b.id)??Number.MAX_SAFE_INTEGER));
  }
  function receiptCoverageOptions(receipt) {
    const groups=new Map();
    for(const source of receipt?.bankSources||[])
      if(/^[a-f0-9]{64}$/.test(source.coverageKey||'')) {
        const group=groups.get(source.coverageKey);
        if(group)group.originals.push(source);else groups.set(source.coverageKey,{key:source.coverageKey,source,originals:[source]});
      }
    return [...groups.values()];
  }
  function renderCoverageChoice(split,original) {
    const groups=receiptCoverageOptions(original);if(!groups.length)return '';
    return label('Original payment coverage','<select name="coverageKey"><option value="">Use the matching original source payment</option>'+
      groups.map(({key,source,originals})=>'<option value="'+e(key)+'"'+(key===split.coverageKey?' selected':'')+'>'+
        e((source.bookedDate||'Original source')+' · '+(source.splitAmount||source.sourceAmount||'')+' · '+
          (source.reference||source.bankReference||source.transactionId||source.sourceName||source.bankImportId||'')+' / '+key.slice(0,12)+(originals.length>1?' · '+originals.length+' retained statements':''))+
        '</option>').join('')+'</select>',true,
      'Select the exact original payment if several retained source payments share the same date, amount or reference.');
  }
  function allInvoices(split) {
    const row=state.editor?.row,map=new Map();
    const inputs=[...(getState()?.invoices||[]),...(row?.invoiceCandidates||[]).map(value=>value.invoice),
      ...(split.funds?.targetInvoices||[])];
    for(const item of inputs)if(item?.id&&item.customerId===split.customerId&&item.status==='ISSUED'&&
      currencyKey(item.currency)===currencyKey(row?.currency))map.set(item.id,item);
    return [...map.values()].sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))||String(a.number).localeCompare(String(b.number)));
  }
  async function editAssignment(rowId) {
    if(lock())return;
    const row=sourceRow(rowId);if(!row)throw new Error('Reload this original statement row before matching it.');
    const saved=currentAssignments()[rowId],cached=state.editor?.bankImportId===state.selectedId&&state.editor.row.id===rowId?state.editor:null;
    state.editor=cached||{bankImportId:state.selectedId,row:clone(row),lookupDate:getAsOf(),distinctPaymentReason:saved?.distinctPaymentReason||'',
      sourceResolutionReason:saved?.sourceResolutionReason||'',splits:saved?saved.splits.map(split=>({...clone(split),key:crypto.randomUUID(),funds:null,
        allocations:split.allocations.map(item=>({...item,key:crypto.randomUUID()})),
        residualAllocations:(split.residualAllocations||[]).map(item=>({...item,key:crypto.randomUUID()})),residualFunds:null})):[]};
    if(!state.editor.splits.length)state.editor.splits.push(newSplit(row));
    state.dialog='assignment';persist();assignmentDialog();
    await refreshAssignmentFunds();
  }
  async function refreshAssignmentFunds() {
    const editor=state.editor;if(!editor)return;
    const generation=(editor.generation||0)+1;editor.generation=generation;
    const receipts=allReceipts(editor.row),ids=[...new Set(editor.splits.flatMap(split=>[
      split.customerId,...(split.action==='CORRECT'?[receipts.find(row=>row.id===split.receiptId)?.customerId]:[])]).filter(Boolean))];
    const results=await Promise.all(ids.map(async id=>[id,await api.customerFunds({customerId:id,asOf:editor.lookupDate})]));
    if(state.editor!==editor||editor.generation!==generation)return;
    const funds=new Map(results);for(const split of editor.splits){
      split.funds=funds.get(split.customerId)||null;
      split.residualFunds=split.action==='CORRECT'?funds.get(receipts.find(row=>row.id===split.receiptId)?.customerId)||null:null;
    }
    if(state.dialog==='assignment')assignmentDialog();
  }
  function assignmentDialog() {
    const editor=state.editor;if(!editor)return;
    state.dialog='assignment';
    const row=editor.row,receiptOptions=allReceipts(row),sum=editor.splits.reduce((total,split)=>{
      try{return total+host.units(split.amount,row.currency);}catch{return total;}
    },0n),unassigned=host.units(row.amount,row.currency)-sum;
    openDialog('Match bank payment','<form id="bank-assignment-form"><div class="row between"><div><h3>'+e(row.reference||row.bankReference||row.transactionId)+'</h3>'+
      '<p>'+e(row.bookedDate)+' · '+e(row.counterparty)+' · <strong>'+money(row.amount,row.currency)+'</strong></p></div>'+
      button('Original source','editor-source')+'</div>'+
      '<div class="form-grid">'+label('Invoice balance date',input('lookupDate',editor.lookupDate,' type="date" required'),
        false,'Invoice and available-receipt views use this date. Each allocation retains its own date.')+
      '<div class="stat"><span>Amount left to assign</span><strong data-bank-unassigned>'+money(host.amount(unassigned,row.currency),row.currency)+'</strong></div></div>'+
      editor.splits.map((split,index)=>renderSplit(split,index,receiptOptions)).join('')+
      '<div class="row bank-original">'+button('Add customer split','add-split','',true)+'</div>'+
      '<section class="section"><h3>Original source matching</h3>'+
      ((row.sourceMatches?.length||row.status==='CONFLICT')?'<p class="small-text">'+e(row.sourceMatches?.length||0)+
        ' original source match'+((row.sourceMatches?.length||0)===1?'':'es')+' are retained with this row.</p>':'')+
      '<div class="form-grid">'+label('Reason to resolve changed bank source',
        '<textarea name="sourceResolutionReason" maxlength="3000">'+e(editor.sourceResolutionReason)+'</textarea>',false,
        'For a shared original transaction ID with changed bank amount or date, explain why this source is the authoritative correction.')+
      label('Reason this is a distinct payment','<textarea name="distinctPaymentReason" maxlength="3000">'+e(editor.distinctPaymentReason)+'</textarea>',false,
        'Use only for coincident date, amount or reference matches that belong to separate actual payments.')+'</div>'+
      '</section>'+actions('Keep customer matches')+'</form>');
    setBusy(isLocked());
  }
  function renderSplit(split,index,receiptOptions) {
    const row=state.editor.row,original=receiptOptions.find(item=>item.id===split.receiptId),invoices=allInvoices(split);
    const sameDate=!original||original.receivedDate===row.bookedDate;
    return '<section class="section bank-split" data-bank-split="'+e(split.key)+'"><div class="row between"><h3>Customer split '+(index+1)+'</h3>'+
      (state.editor.splits.length>1?button('Remove split','remove-split',' data-key="'+e(split.key)+'"',true):'')+'</div><div class="form-grid">'+
      label('Payment treatment',select('action',[['CREATE','Create customer receipt'],['LINK','Link recorded receipt'],['CORRECT','Correct recorded receipt']],split.action))+
      label('Customer','<select name="customerId"'+(split.action==='LINK'?' disabled':'')+'>'+options(customers(),split.customerId,
        split.action==='LINK'?'Customer from original receipt':'Choose the customer')+'</select>')+
      (split.action!=='CREATE'?label('Original recorded receipt','<select name="receiptId"><option value="">Choose the original receipt</option>'+
        receiptOptions.map(item=>'<option value="'+e(item.id)+'"'+(item.id===split.receiptId?' selected':'')+'>'+
          e((item.reference||item.id)+' · '+customerName(item.customerId)+' · '+item.currency.code+' '+item.amount+' · '+item.receivedDate)+'</option>').join('')+
        '</select>',true):'')+
      (split.action!=='CREATE'&&original?renderCoverageChoice(split,original):'')+
      label('Customer payment amount',input('amount',split.amount,' inputmode="decimal" required'))+
      label(split.action==='LINK'?'Original accounting date':split.action==='CORRECT'?'Correction accounting date':'Effective accounting date',
        input('effectiveDate',split.effectiveDate,' type="date" required'+(split.action==='LINK'?' readonly':'')))+
      (split.action==='CORRECT'?label('Correction reason','<textarea name="reason" maxlength="3000" required>'+e(split.reason)+'</textarea>',true):'')+
      (split.action==='LINK'&&!sameDate?label('Reason the bank and receipt dates differ','<textarea name="dateDifferenceReason" maxlength="3000" required>'+
        e(split.dateDifferenceReason)+'</textarea>',true,'The existing receipt keeps its actual received date '+original.receivedDate+
        '; the bank row retains booked date '+row.bookedDate+'.'):'')+
      '</div>'+(original?'<details class="bank-original"><summary>Original receipt and cash dates</summary><dl class="definition">'+
        '<dt>Customer</dt><dd>'+e(customerName(original.customerId))+'</dd><dt>Received date</dt><dd>'+e(original.receivedDate)+'</dd>'+
        '<dt>Accounting date</dt><dd>'+e(original.accountingDate||original.receivedDate)+'</dd><dt>Allocated</dt><dd>'+money(original.allocated,row.currency)+'</dd>'+
        '<dt>Reserved / refunded</dt><dd>'+money(original.reserved,row.currency)+' / '+money(original.refunded,row.currency)+'</dd>'+
        '<dt>Available</dt><dd>'+money(original.available,row.currency)+'</dd></dl></details>':'')+
      '<div class="row between bank-original"><h4>Invoice allocations</h4>'+button('Add invoice','add-allocation',' data-key="'+e(split.key)+'"',true)+'</div>'+
      (split.allocations.length?'<div class="table-wrap"><table><thead><tr><th>Original invoice</th><th class="num">Apply amount</th><th>Allocation date</th><th></th></tr></thead><tbody>'+
        split.allocations.map(item=>'<tr data-bank-allocation="'+e(item.key)+'"><td><select name="invoiceId"><option value="">Choose an original invoice</option>'+
          invoices.map(invoice=>'<option value="'+e(invoice.id)+'"'+(item.invoiceId===invoice.id?' selected':'')+'>'+e((invoice.number||invoice.id)+
            ' · due '+invoice.dueDate+' · '+invoice.currency.code+' '+invoice.amountDue+' remaining')+'</option>').join('')+'</select></td><td>'+
          input('allocationAmount',item.amount,' inputmode="decimal" required')+'</td><td>'+input('allocatedDate',item.allocatedDate,' type="date" required')+
          '</td><td>'+button('Use invoice balance','fill-allocation',' class="small" data-key="'+e(split.key)+'" data-allocation="'+e(item.key)+'"',true)+
          button('Remove','remove-allocation',' class="small" data-key="'+e(split.key)+'" data-allocation="'+e(item.key)+'"',true)+'</td></tr>').join('')+
        '</tbody></table></div>':'<p class="hint">The receipt can remain available in the customer account. Add invoice allocations when the payment settles issued charges.</p>')+
      '<p class="hint bank-original">The combined review checks original customer, currency, cash and every affected allocation date.</p>'+
      (split.action==='CORRECT'&&original?renderRemainingCashInputs(split,original):'')+'</section>';
  }
  function renderRemainingCashInputs(split,original) {
    const rows=split.residualAllocations||[],invoices=allInvoices({...split,customerId:original.customerId,funds:split.residualFunds});
    return '<section class="section bank-original"><div class="row between"><h4>Cash remaining with '+e(customerName(original.customerId))+'</h4>'+
      button('Add invoice for remaining cash','add-residual-allocation',' data-key="'+e(split.key)+'"',true)+'</div>'+
      '<p class="hint">A partial correction preserves the original customer’s remaining payment. Leave that cash available or enter its invoice allocations below. The complete posting review shows the exact remaining amount. Add these allocations once for each original receipt in the posting.</p>'+
      (rows.length?'<div class="table-wrap"><table><thead><tr><th>Original customer invoice</th><th class="num">Apply amount</th><th>Allocation date</th><th></th></tr></thead><tbody>'+
        rows.map(item=>'<tr data-bank-residual-allocation="'+e(item.key)+'"><td><select name="residualInvoiceId"><option value="">Choose the original customer invoice</option>'+
          invoices.map(invoice=>'<option value="'+e(invoice.id)+'"'+(item.invoiceId===invoice.id?' selected':'')+'>'+
            e((invoice.number||invoice.id)+' · due '+invoice.dueDate+' · '+invoice.currency.code+' '+invoice.amountDue+' remaining')+'</option>').join('')+'</select></td><td>'+
          input('residualAmount',item.amount,' inputmode="decimal" required')+'</td><td>'+input('residualAllocatedDate',item.allocatedDate,' type="date" required')+'</td><td>'+
          button('Remove','remove-residual-allocation',' class="small" data-key="'+e(split.key)+'" data-allocation="'+e(item.key)+'"',true)+'</td></tr>').join('')+'</tbody></table></div>':
        '<p class="small-text muted">Any remaining cash will stay available in the original customer account.</p>')+'</section>';
  }
  function captureEditor(form=$('#bank-assignment-form')) {
    const editor=state.editor;if(!form||!editor)return;
    editor.lookupDate=form.elements.lookupDate.value;
    editor.sourceResolutionReason=form.elements.sourceResolutionReason.value;
    editor.distinctPaymentReason=form.elements.distinctPaymentReason.value;
    for(const section of form.querySelectorAll('[data-bank-split]')) {
      const split=editor.splits.find(value=>value.key===section.dataset.bankSplit);if(!split)continue;
      const field=name=>section.querySelector('[name="'+name+'"]')?.value;
      const previous={action:split.action,customerId:split.customerId,receiptId:split.receiptId};
      split.action=field('action');split.customerId=field('customerId')??split.customerId??'';
      split.receiptId=field('receiptId')||'';split.coverageKey=field('coverageKey')??split.coverageKey??'';split.amount=field('amount');split.effectiveDate=field('effectiveDate');
      split.reason=field('reason')??split.reason??'';split.dateDifferenceReason=field('dateDifferenceReason')??split.dateDifferenceReason??'';
      const original=allReceipts(editor.row).find(row=>row.id===split.receiptId);
      if(split.coverageKey&&!receiptCoverageOptions(original).some(row=>row.key===split.coverageKey))split.coverageKey='';
      if(split.action==='LINK')split.customerId=original?.customerId||'';
      if(previous.action!==split.action) {
        split.effectiveDate=split.action==='CORRECT'?getAsOf():editor.row.bookedDate;
        if(split.action==='CREATE')split.receiptId='';
      }
      if(split.action==='LINK'&&original)split.effectiveDate=original.accountingDate||original.receivedDate;
      if(previous.action!==split.action||previous.customerId!==split.customerId||previous.receiptId!==split.receiptId) {
        split.allocations=[];split.funds=null;
      }
      split.residualAllocations ||= [];
      if(previous.action!==split.action||previous.receiptId!==split.receiptId){split.residualAllocations=[];split.residualFunds=null;split.coverageKey='';}
      for(const tr of section.querySelectorAll('[data-bank-allocation]')) {
        const item=split.allocations.find(value=>value.key===tr.dataset.bankAllocation);if(!item)continue;
        item.invoiceId=tr.querySelector('[name=invoiceId]').value;item.amount=tr.querySelector('[name=allocationAmount]').value;
        item.allocatedDate=tr.querySelector('[name=allocatedDate]').value;
      }
      for(const tr of section.querySelectorAll('[data-bank-residual-allocation]')) {
        const item=split.residualAllocations.find(value=>value.key===tr.dataset.bankResidualAllocation);if(!item)continue;
        item.invoiceId=tr.querySelector('[name=residualInvoiceId]').value;item.amount=tr.querySelector('[name=residualAmount]').value;
        item.allocatedDate=tr.querySelector('[name=residualAllocatedDate]').value;
      }
    }
    persist();
  }
  function normalizedSelection(editor) {
    const currency=editor.row.currency;
    const splits=editor.splits.map(split=>{
      if(!['CREATE','LINK','CORRECT'].includes(split.action))throw new Error('Choose how each customer payment should be recorded.');
      if(split.action!=='LINK'&&!split.customerId)throw new Error('Choose the customer for each new or corrected receipt.');
      if(split.action!=='CREATE'&&!split.receiptId)throw new Error('Choose the original receipt to link or correct.');
      if(host.units(split.amount,currency)<=0n)throw new Error('Every customer split must have a positive original-currency amount.');
      if(split.action==='CORRECT'&&!split.reason.trim())throw new Error('Enter the reason for correcting the original receipt.');
      if(split.coverageKey&&!/^[a-f0-9]{64}$/.test(split.coverageKey))throw new Error('Choose an original source payment coverage.');
      const allocations=split.allocations.map(item=>{
        if(!item.invoiceId)throw new Error('Select the original invoice for every allocation.');
        if(host.units(item.amount,currency)<=0n)throw new Error('Each invoice allocation needs a positive amount.');
        return {invoiceId:item.invoiceId,amount:item.amount,allocatedDate:item.allocatedDate};
      });
      const original=split.action!=='CREATE'?allReceipts(editor.row).find(row=>row.id===split.receiptId):null,
        allocationLimit=host.units(split.action==='LINK'?(original?.amount||split.amount):split.amount,currency);
      if(allocations.reduce((sum,item)=>sum+host.units(item.amount,currency),0n)>allocationLimit)
        throw new Error(split.action==='LINK'?'Invoice allocations cannot exceed the original receipt amount.':'Invoice allocations cannot exceed their customer payment split.');
      const residualAllocations=(split.residualAllocations||[]).map(item=>{
        if(split.action!=='CORRECT'||!item.invoiceId)throw new Error('Choose the original customer invoice for each remaining-cash allocation.');
        if(host.units(item.amount,currency)<=0n)throw new Error('Each remaining-cash allocation needs a positive amount.');
        return {invoiceId:item.invoiceId,amount:item.amount,allocatedDate:item.allocatedDate};
      });
      if(residualAllocations.reduce((sum,item)=>sum+host.units(item.amount,currency),0n)>host.units(original?.amount||split.amount,currency))
        throw new Error('Remaining-cash allocations cannot exceed the original receipt amount.');
      return {action:split.action,amount:split.amount,
        ...(residualAllocations.length?{residualAllocations}:{}),
        ...(split.customerId?{customerId:split.customerId}:{}),
        ...(split.action!=='CREATE'?{receiptId:split.receiptId,...(split.coverageKey?{coverageKey:split.coverageKey}:{})}:{}),allocations,
        ...(split.effectiveDate?{effectiveDate:split.effectiveDate}:{}),
        ...(split.reason.trim()?{reason:split.reason.trim()}:{}),
        ...(split.dateDifferenceReason.trim()?{dateDifferenceReason:split.dateDifferenceReason.trim()}:{})};
    });
    if(splits.reduce((sum,split)=>sum+host.units(split.amount,currency),0n)!==host.units(editor.row.amount,currency))
      throw new Error('Assign the exact full bank credit across customer splits before reviewing the posting.');
    return {rowId:editor.row.id,splits,
      ...(editor.sourceResolutionReason.trim()?{sourceResolutionReason:editor.sourceResolutionReason.trim()}:{}),
      ...(editor.distinctPaymentReason.trim()?{distinctPaymentReason:editor.distinctPaymentReason.trim()}:{})};
  }
  function saveAssignment() {
    captureEditor();const editor=state.editor,value=normalizedSelection(editor);
    state.assignments[editor.bankImportId] ||= {};
    if(!state.assignments[editor.bankImportId][value.rowId]&&Object.keys(state.assignments[editor.bankImportId]).length>=100)
      throw new Error('Review and post the current 100 source credits before preparing another posting operation.');
    state.assignments[editor.bankImportId][value.rowId]={...value,source:clone(editor.row)};
    state.review=null;state.editor=null;persist();renderHost();
    openDialog('Customer matches prepared','<p>The original source row and complete customer splits are retained in this browser. Review the combined cash and invoice effects before posting.</p>'+
      actions(null,button('Review prepared credits','preview-posting','',true,true)));
    state.dialog='prepared';
  }
  function renderSelection() {
    const rows=Object.values(currentAssignments()),currency=state.detail?.bankImport.currency||rows[0]?.source?.currency;
    if(!rows.length||!currency)return '';
    return '<section class="panel bank-selection"><div class="panel-head"><div><h2>Prepared customer matches</h2><p class="small-text muted">'+rows.length+
      ' original credit'+(rows.length===1?'':'s')+' · '+rows.reduce((n,row)=>n+row.splits.length,0)+' customer receipts</p></div>'+
      button('Review complete posting','preview-posting','',true,true)+'</div><div class="table-wrap"><table><thead><tr><th>Original source payment</th>'+
      '<th>Customer splits</th><th class="num">Original credit</th><th></th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+e(row.source.reference||row.source.bankReference||row.source.transactionId)+'<span class="subline">'+e(row.source.bookedDate)+'</span></td><td>'+
        row.splits.map(split=>'<span class="subline">'+e(formatStatus(split.action))+' · '+e(customerName(split.customerId))+' · '+money(split.amount,currency)+'</span>').join('')+
        '</td><td class="num">'+money(row.source.amount,currency)+'</td><td><div class="row">'+button('Edit','assign',' class="small" data-id="'+e(row.rowId)+'"',true)+
        button('Remove','remove-assignment',' class="small" data-id="'+e(row.rowId)+'"',true)+'</div></td></tr>').join('')+
      '</tbody></table></div></section>';
  }


  function captureParserOptions(form,draft) {
    if(draft.format!=='MT940')return;
    const value=name=>form.elements.namedItem(name)?.value||'';
    draft.statementOptions={profile:value('mtProfile'),encoding:value('mtEncoding'),
      debitCreditProfile:value('mtDebitCreditProfile'),yearWindowStart:value('mtYearWindowStart'),
      dateBasis:value('mtDateBasis')};
    draft.currencyScalesText=value('mtCurrencyScales');
  }
  function applyParserOptions(payload,draft) {
    if(draft.format!=='MT940')return;
    const value=draft.statementOptions||{};
    if(!['TEXT_BODY','FIN_ENVELOPE'].includes(value.profile))throw new Error('Choose whether the original MT940 file is a statement body or a complete FIN envelope.');
    if(!['ASCII','UTF-8','ISO-8859-1'].includes(value.encoding))throw new Error('Choose the original MT940 character encoding.');
    if(!['CD_ONLY','CD_REVERSALS'].includes(value.debitCreditProfile))throw new Error('Choose the debit and credit convention used by the bank.');
    const yearWindowStart=Number(value.yearWindowStart);
    if(!/^\d{4}$/.test(String(value.yearWindowStart))||!Number.isInteger(yearWindowStart)||yearWindowStart<1900||yearWindowStart>2000)
      throw new Error('Choose the first year of the original statement’s 100-year date window, from 1900 through 2000.');
    if(value.dateBasis!=='VALUE_DATE')throw new Error('Select the original complete MT940 value date as the receipt date.');
    const currencyScales={};
    for(const item of String(draft.currencyScalesText||'').split(/[\n,;]+/).map(part=>part.trim()).filter(Boolean)) {
      const pair=/^([A-Za-z]{3})\s*=\s*([0-6])$/.exec(item);
      if(!pair)throw new Error('Enter additional currency precision as one CODE=decimals entry per line, for example EUR=2.');
      const code=pair[1].toUpperCase();
      if(Object.hasOwn(currencyScales,code))throw new Error('Enter each additional currency precision once.');
      currencyScales[code]=Number(pair[2]);
    }
    if(!draft.accountId&&!Object.keys(currencyScales).length)
      throw new Error('Select the bank account or provide the original statement currencies and their decimal places.');
    payload.statementOptions={profile:value.profile,encoding:value.encoding,debitCreditProfile:value.debitCreditProfile,
      yearWindowStart,dateBasis:'VALUE_DATE',...(Object.keys(currencyScales).length?{currencyScales}:{})};
  }
  function parserOptionsForm(draft) {
    if(draft.format!=='MT940')return '<p class="hint bank-original">OFX inspection preserves the original posted dates, account sections, transaction IDs, pending transactions and corrections.</p>';
    const value=draft.statementOptions||{},year=Number(value.yearWindowStart);
    return '<section class="section"><h3>Original MT940 statement convention</h3><div class="form-grid three">'+
      label('Source envelope',select('mtProfile',[['','Choose the original format'],['TEXT_BODY','Statement text body'],['FIN_ENVELOPE','Complete FIN envelope']],value.profile))+
      label('Character encoding',select('mtEncoding',[['','Choose the original encoding'],'ASCII','UTF-8','ISO-8859-1'],value.encoding))+
      label('Debit and credit convention',select('mtDebitCreditProfile',[['','Choose the bank convention'],['CD_ONLY','Credit / debit only'],['CD_REVERSALS','Credit / debit with reversal marks']],value.debitCreditProfile))+
      label('100-year window begins',input('mtYearWindowStart',value.yearWindowStart,' type="number" min="1900" max="2000" step="1"'),
        false,Number.isInteger(year)&&year>=1900&&year<=2000?'Two-digit years resolve within '+year+'–'+(year+99)+'.':'Choose the first year used to resolve the original two-digit dates.')+
      label('Receipt date basis',select('mtDateBasis',[['','Choose the original date basis'],['VALUE_DATE','Complete original value date']],value.dateBasis),false,
        'The entry month and day remain in the original source record; they do not supply an inferred entry year.')+
      label('Additional currency decimal places','<textarea name="mtCurrencyScales" rows="3" placeholder="EUR=2&#10;JPY=0">'+
        e(draft.currencyScalesText||'')+'</textarea>',false,'The selected account supplies its own precision. Add currencies from other original sections as CODE=decimals, one per line.')+
      '</div></section>';
  }


  function postingSelections() {
    return Object.values(currentAssignments()).map(({source,...selection})=>clone(selection));
  }
  async function previewPosting() {
    if(lock())return;
    const bankImportId=state.selectedId,selections=postingSelections();
    if(!bankImportId||!selections.length)throw new Error('Prepare at least one original bank credit before reviewing.');
    const key=JSON.stringify(selections),generation=(state.previewGeneration||0)+1;
    state.previewGeneration=generation;state.review=null;state.dialog='review-loading';
    openDialog('Review customer payments','<p>Reading the original source matches and all affected customer cash and invoice dates…</p>'+actions(null));
    setBusy(true);
    try {
      const value=await api.previewBankPosting(bankImportId,{selections});
      if(state.selectedId!==bankImportId||generation!==state.previewGeneration||JSON.stringify(postingSelections())!==key)return;
      state.review={bankImportId,selectionsKey:key,value};
      if(state.dialog==='review-loading')reviewDialog();
    } finally {setBusy(false);}
  }
  function reviewDialog() {
    const retained=state.review;if(!retained)return;
    const {proposal,balanceEffects,revision}=retained.value,currency=proposal.account.currency,totals=balanceEffects.totals;
    state.dialog='review';
    openDialog('Review complete bank posting','<form id="bank-posting-form"><dl class="definition">'+
      '<dt>Original statement</dt><dd>'+e(proposal.source.name||state.detail?.bankImport.sourceName)+'</dd>'+
      '<dt>Bank account</dt><dd>'+e(proposal.account.reference)+' · '+e(proposal.account.name)+'</dd>'+
      '<dt>Customer payments</dt><dd>'+proposal.selections.length+' source credits · '+
        proposal.selections.reduce((sum,row)=>sum+row.splits.length,0)+' customer splits</dd>'+
      '<dt>Balance view</dt><dd>'+e(balanceEffects.asOf)+'</dd></dl>'+
      '<div class="stats"><div class="stat"><span>Original credits</span><strong>'+money(totals.sourceCredits,currency)+'</strong></div>'+
      '<div class="stat"><span>New receipts</span><strong>'+money(totals.createdReceiptAmount,currency)+'</strong></div>'+
      '<div class="stat"><span>Linked receipts</span><strong>'+money(totals.linkedReceiptAmount,currency)+'</strong></div>'+
      '<div class="stat"><span>Corrected receipts</span><strong>'+money(totals.correctedReceiptAmount,currency)+'</strong></div>'+
      '<div class="stat"><span>New invoice allocations</span><strong>'+money(totals.allocatedAmount,currency)+'</strong></div></div>'+
      (proposal.selections.some(row=>row.splits.some(split=>split.residualReceipt))?'<p class="notice bank-original">Partial corrections retain the original customer’s remaining cash in the receipts shown below.</p>':'')+
      proposal.selections.map(selection=>reviewSelection(selection,currency)).join('')+
      renderBalanceEffects(balanceEffects)+
      '<details class="section"><summary>Retained statement and posting identity</summary><dl class="definition">'+
        '<dt>Statement identity</dt><dd class="mono">'+e(proposal.source.sha256||proposal.source.sourceSha256)+'</dd>'+
        '<dt>Workspace revision</dt><dd>'+e(revision)+'</dd><dt>Posting</dt><dd class="mono">'+e(proposal.id)+'</dd>'+
      '</dl></details><p class="hint section">Post applies this complete review to the original workspace. New receipt documents and bank reconciliation files remain available with the statement.</p>'+
      actions('Post reviewed customer payments',button('Download complete review','download-review'))+'</form>');
  }
  function reviewSelection(selection,currency) {
    const source=selection.sourceRow;
    return '<section class="section"><h3>'+e(source.reference||source.bankReference||source.transactionId||'Original payment')+'</h3>'+
      '<p>'+e(source.bookedDate)+' · '+e(source.counterparty)+' · <strong>'+money(source.amount,currency)+'</strong></p>'+
      (selection.sourceResolutionReason?'<p class="preline small-text"><strong>Source correction reason:</strong> '+e(selection.sourceResolutionReason)+'</p>':'')+
      (selection.distinctPaymentReason?'<p class="preline small-text"><strong>Distinct payment reason:</strong> '+e(selection.distinctPaymentReason)+'</p>':'')+
      selection.splits.map(split=>'<div class="bank-split"><h4>'+e(formatStatus(split.action))+' · '+e(split.customer.name||split.customer.id)+
        ' · '+money(split.amount,currency)+'</h4><dl class="definition"><dt>Original bank date</dt><dd>'+e(source.bookedDate)+'</dd>'+
        '<dt>Accounting date</dt><dd>'+e(split.accountingDate||split.effectiveDate)+'</dd>'+
        (split.originalReceipt?'<dt>Recorded receipt date</dt><dd>'+e(split.originalReceipt.receivedDate)+'</dd>'+
          '<dt>Original receipt</dt><dd>'+e(split.originalReceipt.reference||split.originalReceipt.id)+'</dd>':'')+
        (split.correctedOriginalAmount!==undefined?'<dt>Original payment covered by correction</dt><dd>'+money(split.correctedOriginalAmount,currency)+'</dd>':'')+
        (split.reason?'<dt>Correction reason</dt><dd class="preline">'+e(split.reason)+'</dd>':'')+
        (split.dateDifferenceReason?'<dt>Date difference reason</dt><dd class="preline">'+e(split.dateDifferenceReason)+'</dd>':'')+'</dl>'+
        (split.releasedAllocations?.length?'<h4 class="bank-original">Original allocations released</h4>'+allocationReviewTable(split.releasedAllocations,currency,true):'')+
        (split.allocations?.length?'<h4 class="bank-original">Invoice allocations</h4>'+allocationReviewTable(split.allocations,currency,false):
          '<p class="hint bank-original">No new invoice allocation is included in this customer split.</p>')+
        reviewLinkedCoverage(split,currency)+
        reviewRemainingReceipt(split,currency)+
        (split.replacementReceiptIds?.length?'<details class="bank-original"><summary>Original receipt relationships</summary><dl class="definition"><dt>Original receipt</dt><dd>'+e(split.originalReceipt?.id)+'</dd><dt>Replacement receipts</dt><dd>'+split.replacementReceiptIds.map(e).join('<br>')+'</dd></dl></details>':'')+'</div>').join('')+'</section>';
  }
  function reviewLinkedCoverage(split,currency) {
    const value=split.sourceCoverage;if(split.action!=='LINK'||!value)return '';
    return '<section class="section bank-original"><h4>Original payment coverage</h4><p class="hint">'+
      e(value.repeatedSource?'Previously linked source payment':'Additional original source coverage')+'</p><dl class="definition">'+
      '<dt>Original receipt amount</dt><dd>'+money(value.receiptAmount,currency)+'</dd>'+
      '<dt>Already matched</dt><dd>'+money(value.beforeMatchedAmount,currency)+'</dd>'+
      '<dt>This source payment</dt><dd>'+money(value.coveredByThisSource,currency)+'</dd>'+
      '<dt>Additional amount matched</dt><dd>'+money(value.newlyMatchedAmount,currency)+'</dd>'+
      '<dt>Matched after posting</dt><dd>'+money(value.afterMatchedAmount,currency)+'</dd>'+
      '<dt>Remaining amount to match</dt><dd>'+money(value.remainingUnmatchedAmount,currency)+'</dd>'+
      '</dl><details><summary>Original coverage identity</summary><p class="mono">'+e(value.key)+'</p></details></section>';
  }
  function reviewRemainingReceipt(split,currency) {
    const row=split.residualReceipt;if(!row)return '';
    return '<section class="section bank-original"><h4>Remaining cash · '+e(row.customer.name||row.customer.id)+' · '+money(row.amount,currency)+'</h4>'+
      '<dl class="definition"><dt>Original receipt date</dt><dd>'+e(row.receivedDate)+'</dd><dt>Accounting date</dt><dd>'+e(row.accountingDate)+'</dd>'+
      '<dt>Payment reference</dt><dd>'+e(row.reference)+'</dd></dl>'+
      (row.allocations?.length?'<h4>Remaining cash applied to invoices</h4>'+allocationReviewTable(row.allocations,currency,false):
        '<p class="hint">This amount remains available in the original customer’s account.</p>')+
      (row.bankSources?.length?'<details class="bank-original"><summary>Preserved original bank sources</summary><pre class="bank-json">'+e(JSON.stringify(row.bankSources,null,2))+'</pre></details>':'')+
      '</section>';
  }
  function allocationReviewTable(rows,currency,released) {
    return '<div class="table-wrap"><table><thead><tr><th>Original invoice</th><th class="num">Amount</th><th>Allocation date</th>'+
      (released?'<th>Release date</th>':'')+'</tr></thead><tbody>'+rows.map(row=>'<tr><td>'+e(row.invoiceNumber||row.invoice?.number||
        getState()?.invoices?.find(item=>item.id===row.invoiceId)?.number||row.invoiceId)+'</td><td class="num">'+money(row.amount,currency)+'</td>'+
        '<td>'+e(row.allocatedDate)+'</td>'+(released?'<td>'+e(row.releasedDate)+
          (row.previousReleasedDate&&row.previousReleasedDate!==row.releasedDate?'<span class="subline">Previously '+e(row.previousReleasedDate)+'</span>':'')+'</td>':'')+
        '</tr>').join('')+'</tbody></table></div>';
  }
  function balanceTable(before,after,currency,kind) {
    const fields=kind==='receipt'?[['status','Status'],['receivedDate','Received date'],['accountingDate','Accounting date'],
      ['amount','Receipt amount'],['allocated','Invoice allocations'],['reserved','Reserved for refund'],['refunded','Refunded'],
      ['netAmount','Receipt net of refunds'],['availableBeforeUnreconciledRefunds','Available before unresolved payouts'],
      ['unreconciledRefundAmount','Refund payout awaiting reconciliation'],['refundDeficit','Cash shortfall'],['available','Available to customer']]:
      [['paymentStatus','Payment status'],['total','Invoice total'],['paid','Paid'],['credited','Credit notes'],
       ['balance','Net invoice balance'],['amountDue','Amount due'],['creditBalance','Credit balance']];
    return '<div class="table-wrap"><table><thead><tr><th>Customer balance</th><th class="num">Before</th><th class="num">After</th></tr></thead><tbody>'+
      fields.filter(([key])=>before?.[key]!==undefined||after?.[key]!==undefined).map(([key,title])=>{
        const scalar=['status','paymentStatus','receivedDate','accountingDate'].includes(key);
        const value=row=>!row?'—':scalar?e(key.endsWith('Date')?row[key]:formatStatus(row[key])):money(row[key],currency);
        return '<tr><td>'+e(title)+'</td><td class="num">'+value(before)+'</td><td class="num">'+value(after)+'</td></tr>';
      }).join('')+'</tbody></table></div>';
  }
  function renderBalanceEffects(effects) {
    const renderRows=(rows,kind)=>rows.map(row=>'<section class="bank-balance"><h4>'+
      e(kind==='invoice'?(row.number||row.id):customerName(row.customerId)+' · Receipt '+row.id)+'</h4>'+
      '<p class="hint">As of '+e(row.asOf||effects.asOf)+'</p>'+balanceTable(row.before,row.after,row.currency,kind)+
      (row.periods?.length?'<details class="bank-original"><summary>All affected dates ('+row.periods.length+')</summary>'+
        row.periods.map(period=>'<div class="bank-balance"><h4>'+e(period.asOf)+'</h4>'+
          balanceTable(period.before,period.after,row.currency,kind)+'</div>').join('')+'</details>':'')+'</section>').join('');
    return '<section class="section"><h3>Customer cash effects</h3>'+renderRows(effects.receipts||[],'receipt')+'</section>'+
      '<section class="section"><h3>Invoice balance effects</h3>'+renderRows(effects.invoices||[],'invoice')+'</section>';
  }
  async function commitPosting() {
    if(lock())return;
    const retained=state.review;
    if(!retained||retained.bankImportId!==state.selectedId||retained.selectionsKey!==JSON.stringify(postingSelections()))
      throw new Error('Review the current customer matches before posting.');
    const {proposal,reviewSha256,revision}=retained.value;
    await mutate('postBankReceipts',[retained.bankImportId,{proposal:clone(proposal),reviewSha256}],
      'Post reviewed bank receipts',{revision});
  }


  async function filesDialog(bankImportId=state.selectedId) {
    const generation=(state.filesGeneration||0)+1;state.filesGeneration=generation;state.dialog='files-loading';
    openDialog('Original statement files','<p>Reading the retained statement, parser report, postings and customer receipt documents…</p>'+actions(null));
    const value=await api.bankImport(bankImportId,{view:'summary'});
    if(generation!==state.filesGeneration||state.dialog!=='files-loading')return;
    if(!Array.isArray(value.files))throw new Error('The original statement file list could not be read.');
    state.fileList={bankImportId,sourceName:value.bankImport.sourceName,files:value.files};state.dialog='files';
    openDialog('Original files · '+value.bankImport.sourceName,'<div class="table-wrap"><table><thead><tr><th>Original file</th><th class="num">Bytes</th><th></th></tr></thead><tbody>'+
      value.files.map(file=>'<tr><td>'+e(file.name)+(file.accountingDate?'<span class="subline">Accounting date '+e(file.accountingDate)+'</span>':'')+
        '</td><td class="num">'+e(file.bytes)+'</td><td>'+button('Download','download-file',' data-id="'+e(bankImportId)+'" data-name="'+e(file.name)+'"')+
        '</td></tr>').join('')+'</tbody></table></div>'+
      '<section class="section"><h3>Current reconciliation</h3><p class="hint">Download the current statement status or complete receipt reconciliation from the original accounting workspace.</p><div class="toolbar">'+
      button('Statement status','download-file',' data-id="'+e(bankImportId)+'" data-name="status.json"')+
      button('Receipt reconciliation','download-file',' data-id="'+e(bankImportId)+'" data-name="reconciliation.json"')+'</div></section>'+actions(null));
  }
  async function downloadBankFile(bankImportId,name) {
    if(state.fileList?.bankImportId!==bankImportId||
      (!state.fileList.files.some(file=>file.name===name)&&!['status.json','reconciliation.json'].includes(name)))
      throw new Error('Reload the original statement file list before downloading this file.');
    const downloadName=/^source\.(csv|ofx|mt940)$/.test(name)?state.fileList.sourceName:name;
    const response=await api.bankImportFile(bankImportId,name);
    saveBlob(await response.blob(),downloadName);
  }
  function reasonDialog(kind,rowId='') {
    if(lock())return;
    const item=state.detail?.bankImport;if(!item)throw new Error('Select the original statement first.');
    const labels={
      ignore:['Exclude this bank row from customer receipts','Ignore row','This original source row remains in the statement with its reason.'],
      restore:['Restore the original bank row','Restore row','The ignored source row returns to customer matching.'],
      reopen:['Reopen bank statement','Reopen statement','Original source decisions and customer postings remain retained. Reopening allows explicit row restoration and receipt correction.'],
      close:['Close bank statement','Close statement','Every original cash credit must already be posted, linked or assigned a reason before the statement can close.']
    };
    const [title,submit,explanation]=labels[kind]||[];if(!title)throw new Error('Choose a supported bank row action.');
    const row=rowId?sourceRow(rowId):null;if(rowId&&!row)throw new Error('Reload this original statement row first.');
    state.dialog='reason';
    openDialog(title,'<form id="bank-reason-form" data-kind="'+e(kind)+'" data-id="'+e(item.id)+'" data-row="'+e(rowId)+'">'+
      '<p>'+e(explanation)+'</p>'+(row?'<p>'+e(row.bookedDate)+' · '+e(row.reference||row.bankReference)+' · '+money(row.amount,row.currency)+'</p>':'')+
      '<div class="form-grid">'+label('Reason','<textarea name="reason" maxlength="3000"'+(kind==='close'?'':' required')+'></textarea>',true)+'</div>'+
      actions(submit)+'</form>');
  }
  function addAllocation(split) {
    const original=allReceipts(state.editor.row).find(row=>row.id===split.receiptId);
    const date=[split.effectiveDate,state.editor.row.bookedDate,original?.accountingDate||original?.receivedDate].filter(Boolean).sort().at(-1);
    split.allocations.push({key:crypto.randomUUID(),invoiceId:'',amount:'',allocatedDate:date});
  }
  function fillAllocation(split,key) {
    const item=split.allocations.find(row=>row.key===key);if(!item)throw new Error('Choose the original invoice allocation.');
    const invoice=allInvoices(split).find(row=>row.id===item.invoiceId);
    if(!invoice)throw new Error('Choose the original invoice before using its remaining balance.');
    const currency=state.editor.row.currency,
      original=allReceipts(state.editor.row).find(row=>row.id===split.receiptId),
      available=split.action==='LINK'?(original?.available??original?.amount??split.amount):split.amount;
    const remainder=host.units(available,currency)-split.allocations.filter(row=>row.key!==key).reduce((sum,row)=>{
      if(!row.amount)return sum;return sum+host.units(row.amount,currency);
    },0n);
    const due=host.units(invoice.amountDue,currency),applied=due<remainder?due:remainder;
    if(applied<=0n)throw new Error('This invoice or customer split has no remaining amount available to allocate.');
    item.amount=host.amount(applied,currency);
    item.allocatedDate=[item.allocatedDate,split.effectiveDate,invoice.issueDate,
      original?.accountingDate||original?.receivedDate].filter(Boolean).sort().at(-1);
  }
  function invalidateInspection() {
    state.inspectionCurrent=false;state.inspectionKey=null;state.review=null;
    const form=$('#bank-source-form'),submit=form?.querySelector('button[type=submit]');
    if(submit){submit.disabled=true;if(Object.hasOwn(submit.dataset,'operationDisabled'))submit.dataset.operationDisabled='1';}
    if(form&&state.inspection&&!form.querySelector('[data-bank-source-stale]')) {
      const notice=document.createElement('p');notice.className='notice bank-original';notice.dataset.bankSourceStale='';
      notice.textContent='The source selection or layout changed. Inspect it again before retaining the statement.';
      form.querySelector('.dialog-actions')?.before(notice);
    }
  }
  function updateEditorTotals() {
    const editor=state.editor,target=$('[data-bank-unassigned]');if(!editor||!target)return;
    try {
      const value=host.units(editor.row.amount,editor.row.currency)-editor.splits.reduce((sum,split)=>sum+host.units(split.amount,editor.row.currency),0n);
      target.innerHTML=money(host.amount(value,editor.row.currency),editor.row.currency);
    } catch {target.textContent='Complete each amount';}
  }
  async function submit(form,values) {
    if(!form.id.startsWith('bank-'))return false;
    if(form.id==='bank-import-search'){state.importSearch=values.search||'';state.importOffset=0;await load();return true;}
    if(form.id==='bank-row-search'){state.rowSearch=values.search||'';state.rowOffset=0;await load();return true;}
    if(lock())return true;
    if(form.id==='bank-account-form') {
      const prior=state.accountDraft,payload={
        ...(prior?.id?{id:prior.id,expectedVersion:prior.version}:{}),
        reference:values.reference.trim(),name:values.name.trim(),currency:{code:values.currencyCode.toUpperCase(),scale:Number(values.currencyScale)},
        method:values.method.trim(),bankId:values.bankId.trim(),accountReference:values.accountReference.trim(),status:values.status,
        ...(prior?.csvLayout?{csvLayout:clone(prior.csvLayout)}:{})
      };
      await mutate('saveBankAccount',[payload],'Save bank account');
    } else if(form.id==='bank-source-form') {
      captureSourceForm();
      if(!state.inspectionCurrent||!state.inspection||state.inspection.requiresLayout)
        throw new Error('Inspect the complete original statement selection and layout before retaining it.');
      const payload=sourcePayload();
      if(!payload.accountId||!payload.sectionId)throw new Error('Choose the original account and statement section.');
      if(state.inspectionKey!==JSON.stringify(payload))throw new Error('Inspect this exact source selection before retaining it.');
      await mutate('importBankSource',[payload],'Retain original bank statement',{revision:state.inspection.revision});
    } else if(form.id==='bank-assignment-form')saveAssignment();
    else if(form.id==='bank-posting-form')await commitPosting();
    else if(form.id==='bank-reason-form') {
      const bankImportId=form.dataset.id,rowIds=form.dataset.row?[form.dataset.row]:[],reason=values.reason.trim();
      if(form.dataset.kind==='ignore')await mutate('ignoreBankRows',[bankImportId,{rowIds,reason}],'Ignore original bank row');
      else if(form.dataset.kind==='restore'||form.dataset.kind==='reopen')
        await mutate('restoreBankRows',[bankImportId,{rowIds,reason}],form.dataset.kind==='reopen'?'Reopen original bank statement':'Restore original bank row');
      else if(form.dataset.kind==='close')await mutate('closeBankImport',[bankImportId,{reason}],'Close original bank statement');
    }
    return true;
  }
  async function afterMutation(result,operation) {
    if(!methods.includes(operation.method))return;
    host.showBank?.();state.review=null;
    if(operation.method==='saveBankAccount') {
      const returning=state.returnToSource;state.returnToSource=false;
      if(returning&&result.bankAccount?.id){state.sourceDraft ||= {format:'CSV',file:null,csvLayout:emptyLayout(),sectionId:''};state.sourceDraft.accountId=result.bankAccount.id;invalidateInspection();}
      await load({quiet:true});persist();
      if(returning)sourceDialog();else accountsDialog();
      return;
    }
    if(operation.method==='importBankSource') {
      state.selectedId=result.bankImport?.id||state.selectedId;state.accountFilter=result.bankImport?.accountId||state.accountFilter;
      state.sourceDraft=null;state.inspection=null;state.inspectionCurrent=false;state.inspectionKey=null;
      state.importOffset=0;state.view='rows';state.rowOffset=0;state.rowStatus='';state.direction='';state.rowSearch='';
    }
    if(operation.method==='postBankReceipts') {
      const bankImportId=operation.args[0],selections=operation.args[1].proposal.selections;
      for(const item of selections)delete state.assignments[bankImportId]?.[item.rowId];
      if(state.editor?.bankImportId===bankImportId&&selections.some(item=>item.rowId===state.editor.row.id))state.editor=null;
      state.selectedId=result.bankImport?.id||bankImportId;state.view='postings';state.rowOffset=0;
    }
    if(operation.method==='ignoreBankRows')for(const rowId of operation.args[1].rowIds)delete state.assignments[operation.args[0]]?.[rowId];
    persist();await load({quiet:true});
  }


  function onInput(target) {
    if(target.closest('#bank-source-form')){captureSourceForm();invalidateInspection();}
    if(target.closest('#bank-assignment-form')){captureEditor();state.review=null;updateEditorTotals();}
  }
  async function onChange(target) {
    if(target.matches('[data-bank-filter]')) {
      if(target.dataset.bankFilter==='account')state.accountFilter=target.value;
      else state.importStatus=target.value;
      state.importOffset=0;persist();await load();return;
    }
    if(target.matches('[data-bank-row-filter]')) {
      if(target.dataset.bankRowFilter==='status')state.rowStatus=target.value;
      else state.direction=target.value;
      state.rowOffset=0;await load();return;
    }
    if(target.closest('#bank-source-form')) {
      captureSourceForm();invalidateInspection();
      if(target.matches('[data-bank-source-file]')){await chooseSourceFile(target.files?.[0]);return;}
      const draft=state.sourceDraft;
      if(target.name==='accountId') {
        draft.sectionId='';
        const selected=account(draft.accountId);if(selected?.csvLayout)draft.csvLayout=clone(selected.csvLayout);
      }
      if(target.name==='format'){draft.sectionId='';state.inspection=null;}
      if(target.name==='csvDelimiter'){draft.csvLayout.columns={};state.inspection=null;}
      persist();if(['accountId','format','csvAmountMode','csvDelimiter','sectionId'].includes(target.name))sourceDialog();
      return;
    }
    if(target.closest('#bank-assignment-form')) {
      captureEditor();state.review=null;
      if(['action','customerId','receiptId','lookupDate'].includes(target.name)){assignmentDialog();await refreshAssignmentFunds();}
      else updateEditorTotals();
    }
  }
  async function click(control) {
    const action=control.dataset.action;if(!action?.startsWith('bank-'))return false;
    if(control.hasAttribute('data-write')&&lock())return true;
    if(action==='bank-reload')await load();
    else if(action==='bank-accounts')accountsDialog();
    else if(action==='bank-add-account')accountDialog();
    else if(action==='bank-edit-account')accountDialog(account(control.dataset.id));
    else if(action==='bank-new-import')sourceDialog();
    else if(action==='bank-source-add-account'){captureSourceForm();accountDialog(null,{returnToSource:true});}
    else if(action==='bank-inspect-source'){if(!lock())await inspectSource();}
    else if(action==='bank-open-import') {
      state.selectedId=control.dataset.id;state.rowOffset=0;state.rowStatus='';state.direction='';state.rowSearch='';state.view='rows';
      state.review=null;persist();await load();
    } else if(action==='bank-imports-page'){state.importOffset=Number(control.dataset.offset);await load();}
    else if(action==='bank-rows-page'){state.rowOffset=Number(control.dataset.offset);await load();}
    else if(action==='bank-detail-view'){state.view=control.dataset.view;state.rowOffset=0;await load();}
    else if(action==='bank-files')await filesDialog();
    else if(action==='bank-download-file')await downloadBankFile(control.dataset.id,control.dataset.name);
    else if(action==='bank-row-source') {
      const row=sourceRow(control.dataset.id);if(!row)throw new Error('Reload this original source row.');
      state.dialog='source-row';openDialog('Original bank transaction',renderRaw(row)+actions(null));
    } else if(action==='bank-editor-source') {
      captureEditor();state.dialog='editor-source';
      openDialog('Original bank transaction',renderRaw(state.editor.row)+actions(null,button('Back to customer matches','editor-back','',true)));
    } else if(action==='bank-editor-back')assignmentDialog();
    else if(action==='bank-assign')await editAssignment(control.dataset.id);
    else if(action==='bank-add-split') {
      captureEditor();if(state.editor.splits.length>=100)throw new Error('A source credit supports up to 100 customer splits.');
      const split=newSplit(state.editor.row);split.amount=host.amount(0n,state.editor.row.currency);
      state.editor.splits.push(split);persist();assignmentDialog();
    } else if(['bank-add-residual-allocation','bank-remove-residual-allocation'].includes(action)) {
      captureEditor();const editor=state.editor,split=editor?.splits.find(item=>item.key===control.dataset.key),
        original=split&&allReceipts(editor.row).find(item=>item.id===split.receiptId);
      if(!split||split.action!=='CORRECT'||!original)throw new Error('Choose the original receipt being corrected.');
      split.residualAllocations ||= [];
      if(action==='bank-add-residual-allocation') {
        if(split.residualAllocations.length>=100)throw new Error('Use up to 100 original-customer invoices for remaining cash.');
        split.residualAllocations.push({key:crypto.randomUUID(),invoiceId:'',amount:'',
          allocatedDate:[split.effectiveDate,original.accountingDate||original.receivedDate].filter(Boolean).sort().at(-1)});
      } else split.residualAllocations=split.residualAllocations.filter(item=>item.key!==control.dataset.allocation);
      state.review=null;persist();assignmentDialog();
    } else if(['bank-remove-split','bank-add-allocation','bank-remove-allocation','bank-fill-allocation'].includes(action)) {
      captureEditor();const editor=state.editor,split=editor?.splits.find(item=>item.key===control.dataset.key);
      if(!split)throw new Error('Return to the customer payment editor.');
      if(action==='bank-remove-split') {
        if(editor.splits.length<2)throw new Error('Keep at least one customer split.');
        editor.splits=editor.splits.filter(item=>item!==split);
      } else if(action==='bank-add-allocation') {
        if(split.allocations.length>=100)throw new Error('A customer split supports up to 100 invoice allocations.');
        addAllocation(split);
      } else if(action==='bank-remove-allocation')split.allocations=split.allocations.filter(item=>item.key!==control.dataset.allocation);
      else fillAllocation(split,control.dataset.allocation);
      state.review=null;persist();assignmentDialog();
    } else if(action==='bank-remove-assignment') {
      delete currentAssignments()[control.dataset.id];state.review=null;persist();renderHost();
    } else if(action==='bank-preview-posting')await previewPosting();
    else if(action==='bank-download-review') {
      if(!state.review)throw new Error('Review the customer payment posting first.');
      saveBlob(new Blob([JSON.stringify(state.review.value,null,2)+'\n'],{type:'application/json'}),'bank-posting-review.json');
    } else if(action==='bank-ignore-row')reasonDialog('ignore',control.dataset.id);
    else if(action==='bank-restore-row')reasonDialog('restore',control.dataset.id);
    else if(action==='bank-reopen')reasonDialog('reopen');
    else if(action==='bank-close-import')reasonDialog('close');
    return true;
  }
  function close() {
    captureSourceForm();captureEditor();state.dialog=null;
    state.previewGeneration=(state.previewGeneration||0)+1;state.filesGeneration=(state.filesGeneration||0)+1;
    state.sourceGeneration++;persist();
  }
  return {methods,render,load,submit,click,afterMutation,close,input:onInput,
    change(target){void onChange(target).catch(showError);}};
}
