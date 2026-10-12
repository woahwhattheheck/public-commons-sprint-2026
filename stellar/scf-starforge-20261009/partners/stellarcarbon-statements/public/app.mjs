import {StellarcarbonClient} from '/stellarcarbon/client.mjs';
const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const client=new StellarcarbonClient();
const ui={state:null,tab:'overview',cursor:null,previous:[],busy:false,report:null,statementId:null,comparison:null,comparisonTable:'sinking_txs',comparisonPage:0,contributionFilter:{},retirementFilter:{},accountingCustomers:[],table:null,tableOffset:0,captureTimer:null};
const tables=['sinking_txs','sink_status','retirements','retirement_from_block','minted_blocks','distribution_txs','vcs_projects'];
const tableTitles={sinking_txs:'Sinking transactions',sink_status:'Retirement allocations',retirements:'Retirement certificates',retirement_from_block:'Retired blocks',minted_blocks:'Minted blocks',distribution_txs:'Distribution transactions',vcs_projects:'Impact projects'};
const selected=()=>({editionId:$('#edition').value,customerId:$('#customer').value,projectId:$('#project').value,fromDate:$('#from-date').value,beforeDate:$('#before-date').value});
const customerName=id=>ui.state.customers.find(row=>row.id===id)?.name||id||'Unassigned';
const projectName=id=>ui.state.projects.find(row=>row.id===id)?.name||id||'—';
const labels={COMPLETE:'Complete',PARTIAL:'Partially retired',AWAITING_RETIREMENT:'Awaiting retirement',ASSIGNED:'Assigned',UNASSIGNED:'Unassigned',CONFLICT:'Conflicting assignments',TRANSACTION:'Transaction',RECIPIENT:'Recipient',FUNDER:'Funder',IDLE:'Ready',RUNNING:'Acquiring original records',INTERRUPTED:'Acquisition interrupted','native-backup':'Complete native backup','api-capture':'Native API capture'};
const readable=value=>labels[value]||value;
function displayDate(value,withTime=false){
  if(!value)return '—';
  const normalized=/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00Z':/^\d{4}-\d{2}-\d{2}T/.test(value)&&!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?value+'Z':value;
  const date=new Date(normalized);if(!Number.isFinite(date.getTime()))return value;
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(date)+(withTime?' UTC':'');
}
const badge=value=>'<span class="badge">'+esc(readable(value))+'</span>';
const accountingName=id=>id?(ui.accountingCustomers.find(row=>row.id===id)?.name||'Linked original customer'):'Not linked';
const button=(action,id,label,extra='')=>'<button type="button" class="small" data-action="'+action+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
const options=(rows,value,emptyLabel)=> (emptyLabel!==undefined?'<option value="">'+esc(emptyLabel)+'</option>':'')+rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===value?' selected':'')+'>'+esc(row.name||row.label||row.id)+'</option>').join('');
const input=(name,label,value='',type='text',extra='')=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
const textarea=(name,label,value='')=>'<label class="span-2">'+esc(label)+'<textarea name="'+name+'">'+esc(value)+'</textarea></label>';
function table(columns,rows){return '<div class="table-wrap"><table><thead><tr>'+columns.map(column=>'<th'+(column.number?' class="number"':'')+'>'+esc(column.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(column=>'<td'+(column.number?' class="number"':'')+'>'+(column.render?column.render(row):esc(row[column.key]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
const empty=(title,description)=>'<div class="empty"><h3>'+esc(title)+'</h3><p class="muted">'+esc(description)+'</p></div>';
const heading=(title,description,actions='')=>'<div class="page-heading"><div><h2>'+esc(title)+'</h2><p class="muted">'+esc(description)+'</p></div><div class="actions">'+actions+'</div></div>';
const metrics=items=>'<div class="metrics">'+items.map(([value,label])=>'<div class="metric"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';
function notice(message,error=false){$('#notice').textContent=message;$('#notice').classList.toggle('error',error);const local=$('#dialog-notice');if(local){local.textContent=message;local.classList.toggle('error',error);}}
function busy(value){ui.busy=value;document.querySelectorAll('[data-mutates]').forEach(node=>{node.disabled=value;});}
async function perform(work){if(ui.busy)return;busy(true);try{await work();}catch(error){notice(error.message,true);}finally{busy(false);}}
function operation(){return {revision:ui.state.revision,requestId:crypto.randomUUID(),actor:$('#operator').value.trim()||'Local operator'};}
function dialog(title,markup){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML='<p id="dialog-notice" class="notice" role="status"></p>'+markup;if(!$('#dialog').open)$('#dialog').showModal();}
const close=()=>$('#dialog').close();
function values(form){return Object.fromEntries([...new FormData(form)].filter(([,value])=>typeof value==='string'));}
function currentEdition(){return ui.state.editions.find(row=>row.id===$('#edition').value);}
async function refresh({renderPage=true}={}){
  const old=selected();ui.state=await client.state();
  $('#workspace-name').textContent=ui.state.name;$('#revision').textContent='Revision '+ui.state.revision;
  $('#edition').innerHTML=options(ui.state.editions,old.editionId||ui.state.editions.at(-1)?.id);
  if(!$('#edition').value&&ui.state.editions.length)$('#edition').value=ui.state.editions.at(-1).id;
  $('#customer').innerHTML=options(ui.state.customers,old.customerId,'All customers');
  $('#project').innerHTML=options(ui.state.projects.filter(row=>!$('#customer').value||row.customerId===$('#customer').value),old.projectId,'All projects');
  if(renderPage)await render();
}
function resetPage(){ui.cursor=null;ui.previous=[];}
function pagination(result){return '<div class="pagination"><span>'+result.items.length+' records on this page · '+result.total+' match this selection</span><div class="actions"><button data-action="previous-page" type="button"'+(!ui.previous.length?' disabled':'')+'>Previous</button><button data-action="next-page" type="button" data-cursor="'+esc(result.nextCursor||'')+'"'+(!result.nextCursor?' disabled':'')+'>Next</button></div></div>';}
function periodLabel(){const value=selected();return (value.fromDate?displayDate(value.fromDate):'Beginning of retained records')+' to before '+(value.beforeDate?displayDate(value.beforeDate):'end of retained records');}
function contributionColumns(){return [
  {label:'Created',render:row=>esc(displayDate(row.created_at))},
  {label:'Contribution',render:row=>button('contribution',row.hash,row.hash.slice(0,12)+'…')+'<span class="secondary">'+esc(row.toid)+'</span>'},
  {label:'Customer / project',render:row=>esc(customerName(row.assignment.customerId))+'<span class="secondary">'+esc(projectName(row.assignment.projectId))+'</span>'},
  {label:'Recipient',render:row=>'<code>'+esc(row.recipient)+'</code>'},
  {label:'CARBON',key:'carbon_amount',number:true},{label:'Allocated',key:'allocated',number:true},{label:'Remaining',key:'remaining',number:true},
  {label:'Status',render:row=>badge(row.collectionStatus)+(row.assignment.status!=='ASSIGNED'?'<span class="secondary">'+esc(readable(row.assignment.status))+'</span>':'')},
];}
function retirementColumns(){return [
  {label:'Certificate',render:row=>button('retirement',row.certificate_id,row.certificate_id)},
  {label:'Retirement date',render:row=>esc(displayDate(row.retirement_date))},
  {label:'Beneficiary',key:'retirement_beneficiary'},
  {label:'Full certificate VCU',key:'vcu_amount',number:true},
  {label:'Attributed CARBON',key:'attributedAmount',number:true},
  {label:'Impact project',render:row=>esc(row.impactProject?.name||row.vcs_project_id)},
];}
async function render(){
  document.querySelectorAll('[data-tab]').forEach(node=>node.setAttribute('aria-current',node.dataset.tab===ui.tab?'page':'false'));
  const main=$('#main'),selection=selected();
  if(!ui.state.editions.length&&!['capture','customers','assignments'].includes(ui.tab)){
    main.innerHTML=heading('Receive an original source edition','Import the complete seven-table backup or acquire a fixed period from the native API.',button('go-capture','','Import source'))+
      empty('The workspace is ready for original records','The retained public edition can be received directly from Import and receive.');return;
  }
  if(ui.tab==='overview'){
    const [contributions,retirements]=await Promise.all([client.contributions({...selection,limit:1}),client.retirements({...selection,limit:1})]);
    const source=currentEdition();
    main.innerHTML=heading('Period overview',periodLabel(),button('new-statement','','Prepare statement'))+
      metrics([[contributions.totals.carbon,'CARBON contributed in the period'],[contributions.totals.allocated,'Allocated to retirement in this edition'],[contributions.totals.remaining,'Remaining for these contributions'],[retirements.totals.attributedCarbon,'Attributed retirement dated in the period']])+
      '<div class="grid"><section class="panel"><h3>Working edition</h3><dl><dt>Source</dt><dd>'+esc(source.label)+'</dd><dt>Imported</dt><dd>'+esc(displayDate(source.importedAt,true))+'</dd><dt>Original contribution dates</dt><dd>'+esc(displayDate(source.firstContribution))+' through '+esc(displayDate(source.lastContribution))+'</dd><dt>Transactions</dt><dd>'+source.counts.sinking_txs+'</dd><dt>Retirement allocations</dt><dd>'+source.counts.sink_status+'</dd><dt>Certificates</dt><dd>'+source.counts.retirements+'</dd></dl><p>'+button('edition',source.id,'Inspect full edition')+'</p></section>'+
      '<section class="panel"><h3>Customer attribution</h3><p>'+contributions.totals.count+' contributions match this selection; '+contributions.totals.unassigned+' are unassigned and '+contributions.totals.conflicts+' have conflicting assignments.</p><p>Transaction rules take precedence over recipient rules, which take precedence over funder rules. Original funders, recipients and impact projects remain visible.</p><div class="actions">'+button('go-assignments','','Review assignments')+button('go-customers','','Customers and projects')+'</div></section></div>'+
      '<section class="panel"><h3>How this period is reported</h3><p>Contributions use their creation dates. Their allocations show retirement known in the selected source edition, including certificates dated after the period. The retirement register uses certificate retirement dates independently.</p>'+
      (ui.state.integration.accounting?'<div class="actions"><a class="button" href="/receivables/">Invoices and receipts</a><a class="button" href="/payment-plans/">Customer payment plans</a><a class="button" href="/customer-statements/">Accounting customers</a></div>':'<p class="muted">An original accounting directory can be selected when this Application is opened to join its customer, invoice and payment-plan screens.</p>')+'</section>';
  }else if(ui.tab==='contributions'){
    const result=await client.contributions({...selection,...ui.contributionFilter,cursor:ui.cursor,limit:50});
    main.innerHTML=heading('Contributions',periodLabel())+
      '<form id="contribution-filter" class="inline-form">'+input('search','Search original records',ui.contributionFilter.search,'search')+
      '<label>Retirement status<select name="status">'+options([{id:'COMPLETE',name:'Complete'},{id:'PARTIAL',name:'Partially retired'},{id:'AWAITING_RETIREMENT',name:'Awaiting retirement'}],ui.contributionFilter.status,'All statuses')+'</select></label>'+
      '<label>Assignment<select name="assignmentStatus">'+options([{id:'ASSIGNED',name:'Assigned'},{id:'UNASSIGNED',name:'Unassigned'},{id:'CONFLICT',name:'Conflicting assignments'}],ui.contributionFilter.assignmentStatus,'All assignments')+'</select></label><button type="submit">Apply record filters</button></form>'+metrics([[result.totals.count,'Transactions'],[result.totals.carbon,'CARBON'],[result.totals.allocated,'Allocated in the source edition'],[result.totals.remaining,'Remaining']])+
      (result.items.length?table(contributionColumns(),result.items)+pagination(result):empty('No matching contributions','Adjust the retained edition or the current customer, project and date selection.'));
  }else if(ui.tab==='retirements'){
    const result=await client.retirements({...selection,...ui.retirementFilter,cursor:ui.cursor,limit:50});
    main.innerHTML=heading('Retirement register','Certificate dates: '+periodLabel())+
      '<form id="retirement-filter" class="inline-form">'+input('beneficiary','Original beneficiary address prefix',ui.retirementFilter.beneficiary)+
      '<button type="submit">Apply beneficiary filter</button></form>'+
      metrics([[result.totals.certificates,'Distinct certificates'],[result.totals.certificateCarbon,'Full certificate VCU'],[result.totals.attributedCarbon,'Attributed CARBON'],[result.items.length,'Records on this page']])+
      '<p class="form-note">Full certificate VCU is shown once per certificate. Attributed CARBON is the sum of allocations tied to the selected customer or project.</p>'+
      (result.items.length?table(retirementColumns(),result.items)+pagination(result):empty('No matching certificates','The contribution allocation view also shows linked certificates dated outside this period.'));
  }else if(ui.tab==='customers'){
    ui.accountingCustomers=await accountingCustomers();
    main.innerHTML=heading('Customers and customer projects','Operator-owned assignments remain separate from original recipient profiles and impact projects.',button('new-customer','','Add customer')+button('new-project','','Add project'))+
      '<h3>Customers</h3>'+table([{label:'Name',key:'name'},{label:'Reference',key:'reference'},{label:'Accounting customer',render:row=>esc(accountingName(row.merchantCustomerId))},{label:'Note',key:'note'},{label:'',render:row=>button('edit-customer',row.id,'Edit')}],ui.state.customers)+
      '<h3>Customer projects</h3>'+table([{label:'Project',key:'name'},{label:'Customer',render:row=>esc(customerName(row.customerId))},{label:'Reference',key:'reference'},{label:'Note',key:'note'},{label:'',render:row=>button('edit-project',row.id,'Edit')}],ui.state.projects);
  }else if(ui.tab==='assignments'){
    main.innerHTML=heading('Customer assignments','Apply a source transaction, recipient or funder to a named customer and optional project.',button('new-assignment','','Add assignment'))+
      table([{label:'Match',render:row=>badge(row.kind)+'<span class="secondary"><code>'+esc(row.value)+'</code></span>'},{label:'Customer',render:row=>esc(customerName(row.customerId))},{label:'Project',render:row=>esc(projectName(row.projectId))},{label:'Effective period',render:row=>esc(row.fromDate?displayDate(row.fromDate):'Any start')+' → '+esc(row.beforeDate?'before '+displayDate(row.beforeDate):'Any end')},{label:'Active',render:row=>row.active?'Yes':'No'},{label:'Note',key:'note'},{label:'',render:row=>button('edit-assignment',row.id,'Edit')}],ui.state.assignments)+
      '<p class="form-note">A transaction match wins over a recipient match; a recipient match wins over a funder match. Equal-priority matches to different customers/projects remain visibly conflicting. Saved statement versions retain their original assignment snapshot.</p>';
  }else if(ui.tab==='statements'){
    const rows=ui.state.statements.flatMap(statement=>statement.versions.map(version=>({id:statement.id,...version}))).reverse();
    main.innerHTML=heading('Saved statement versions','Reopen a complete saved edition, revise its selection or produce its customer files.',button('new-statement','','Prepare statement'))+
      (rows.length?table([{label:'Statement',key:'title'},{label:'Version',key:'version'},{label:'Customer / project',render:row=>esc(customerName(row.customerId))+'<span class="secondary">'+esc(projectName(row.projectId))+'</span>'},{label:'Period',render:row=>esc(displayDate(row.fromDate))+' to before '+esc(displayDate(row.beforeDate))},{label:'CARBON',render:row=>esc(row.totals.carbon),number:true},{label:'Remaining',render:row=>esc(row.totals.remaining),number:true},{label:'Saved',render:row=>esc(displayDate(row.createdAt,true))},{label:'',render:row=>button('statement',row.id,'Open','data-version="'+row.version+'"')}],rows):empty('Prepare the first statement','Choose a source edition, customer or whole portfolio, and a dated period.'));
  }else if(ui.tab==='sources'){
    main.innerHTML=heading('Retained source editions','Original files and response bodies remain attached to every imported edition.',button('go-capture','','Import source'))+
      table([{label:'Edition',key:'label'},{label:'Format',render:row=>esc(readable(row.format))},{label:'Imported',render:row=>esc(displayDate(row.importedAt,true))},{label:'Contributions',render:row=>row.counts.sinking_txs,number:true},{label:'CARBON',key:'carbon',number:true},{label:'Remaining',key:'remaining',number:true},{label:'',render:row=>button('edition',row.id,'Inspect')}],ui.state.editions);
  }else if(ui.tab==='compare'){
    main.innerHTML=heading('Compare complete source editions','Review added, removed and changed native records, including every changed field.')+
      '<form id="compare-form" class="panel inline-form"><label>Before<select name="beforeId">'+options(ui.state.editions,ui.state.editions[0]?.id)+'</select></label><label>After<select name="afterId">'+options(ui.state.editions,selection.editionId)+'</select></label><button type="submit" class="primary">Compare</button></form><section id="comparison-result"></section>';
    if(ui.comparison)renderComparison();
  }else if(ui.tab==='capture'){
    main.innerHTML=heading('Import and receive','Retain original source editions and reopen whole editable workspaces.')+
      '<div class="grid"><section class="panel"><h3>Complete native backup</h3><p>Select all seven original sc-audit NDJSON files and an optional source manifest. Table order and numeric lexemes are retained.</p><form id="import-form">'+input('label','Edition label','','text','required')+'<p><label>Native source files<input name="files" type="file" multiple accept=".ndjson,.json" required></label></p><button type="submit" class="primary" data-mutates>Receive native files</button></form><hr><p>The packaged original public edition contains all 176 source rows from November 2021 through March 2026.</p><button type="button" data-action="import-retained" data-mutates>Receive retained original edition</button></section>'+
      '<section class="panel"><h3>Native API period acquisition</h3><p>Read complete ascending pages to terminal empty pages, then receive connected original certificate and transaction details.</p><form id="capture-form"><div class="form-grid">'+input('label','Edition label','','text','required')+'<label>Network<select name="baseUrl"><option value="https://api.stellarcarbon.io">Mainnet</option><option value="https://testnet-api.stellarcarbon.io">Testnet</option></select></label>'+input('fromDate','From date',selection.fromDate,'date','required')+input('beforeDate','Before date',selection.beforeDate,'date','required')+'</div><p><label class="check"><input name="resume" type="checkbox">Resume the retained original acquisition</label></p><button type="submit" class="primary" data-mutates>Acquire original records</button></form><p id="capture-status" role="status"></p></section></div>'+
      '<section class="panel"><h3>Receive a whole workspace</h3><p>Receive the original sources, customer/project assignments, all statement versions and saved invoice links into a new private directory. The received desk opens for independent editing.</p><form id="receive-form" class="form-grid">'+input('directory','New private directory','','text','required placeholder="Absolute directory path"')+'<label>Whole workspace JSON<input name="handover" type="file" accept=".json" required></label><div class="span-2"><button type="submit" class="primary" data-mutates>Receive and open</button> <a class="button" href="/api/handover">Export this whole workspace</a></div></form><div id="receive-result"></div></section>';
    await updateCapture(false);
  }
}
async function accountingCustomers(){
  if(!ui.state.integration.accounting)return [];
  const response=await fetch('/api/receivables/state'),body=await response.json();
  if(!response.ok)throw new Error(body.error?.message||'The accounting customer list could not be opened.');
  return body.customers||[];
}
async function customerEditor(record={}){
  const customers=await accountingCustomers();
  dialog(record.id?'Edit customer':'Add customer','<form id="customer-form" data-id="'+esc(record.id||'')+'" data-version="'+(record.version||'')+'"><div class="form-grid">'+
    input('name','Customer name',record.name,'text','required maxlength="300"')+input('reference','Customer reference',record.reference)+
    (ui.state.integration.accounting?'<label class="span-2">Original accounting customer<select name="merchantCustomerId">'+options(customers,record.merchantCustomerId,'Choose when invoicing this customer')+'</select></label>':'<input type="hidden" name="merchantCustomerId" value="'+esc(record.merchantCustomerId||'')+'"><p class="form-note">Choose the original accounting workspace when opening this desk to select a customer by name.</p>')+
    textarea('note','Operator note',record.note)+'</div><div class="form-actions"><button class="primary" type="submit" data-mutates>Save customer</button></div></form>');
}
function projectEditor(record={}){
  dialog(record.id?'Edit project':'Add customer project','<form id="project-form" data-id="'+esc(record.id||'')+'" data-version="'+(record.version||'')+'"><div class="form-grid">'+
    '<label>Customer<select name="customerId" required>'+options(ui.state.customers,record.customerId||selected().customerId,'Choose customer')+'</select></label>'+input('name','Project name',record.name,'text','required maxlength="300"')+
    input('reference','Project reference',record.reference)+textarea('note','Operator note',record.note)+'</div><div class="form-actions"><button class="primary" type="submit" data-mutates>Save project</button></div></form>');
}
function assignmentEditor(record={}){
  dialog(record.id?'Edit assignment':'Assign original records','<form id="assignment-form" data-id="'+esc(record.id||'')+'" data-version="'+(record.version||'')+'"><div class="form-grid">'+
    '<label>Match field<select name="kind">'+options([{id:'TRANSACTION',name:'Exact transaction hash'},{id:'RECIPIENT',name:'Recipient address'},{id:'FUNDER',name:'Funder address'}],record.kind||'RECIPIENT')+'</select></label>'+
    input('value','Original hash or address',record.value,'text','required')+'<label>Customer<select name="customerId" required>'+options(ui.state.customers,record.customerId||selected().customerId,'Choose customer')+'</select></label>'+
    '<label>Customer project<select name="projectId">'+options(ui.state.projects.filter(row=>row.customerId===(record.customerId||selected().customerId)),record.projectId,'No project')+'</select></label>'+
    input('fromDate','Effective from',record.fromDate,'date')+input('beforeDate','Effective before',record.beforeDate,'date')+
    textarea('note','Assignment note',record.note)+'</div><p><label class="check"><input name="active" type="checkbox"'+(record.active===false?'':' checked')+'>Active assignment</label></p>'+
    '<div class="form-actions"><button type="submit" class="primary" data-mutates>Save assignment</button></div></form>');
}
async function openContribution(hash){
  const row=await client.contribution(hash,{editionId:selected().editionId});
  dialog('Contribution '+hash.slice(0,12)+'…','<dl><dt>Transaction</dt><dd><code>'+esc(row.hash)+'</code></dd><dt>TOID</dt><dd>'+esc(row.toid)+'</dd><dt>Created</dt><dd>'+esc(displayDate(row.created_at,true))+'</dd><dt>Funder</dt><dd><code>'+esc(row.funder)+'</code></dd><dt>Recipient</dt><dd><code>'+esc(row.recipient)+'</code></dd><dt>Customer / project</dt><dd>'+esc(customerName(row.assignment.customerId))+' / '+esc(projectName(row.assignment.projectId))+'</dd><dt>Impact project</dt><dd>'+esc(row.impactProject?.name||row.vcs_project_id)+'</dd><dt>Source payment</dt><dd>'+esc(row.source_asset_amount)+' '+esc(row.source_asset_code)+'<span class="secondary">'+esc(row.source_asset_issuer||'Native asset')+'</span></dd><dt>Destination amount</dt><dd>'+esc(row.dest_asset_amount)+' '+esc(row.dest_asset_code)+'</dd><dt>Memo</dt><dd>'+esc(row.memo_value)+'</dd></dl>'+
    '<div class="actions"><p>'+button('assign-source',row.hash,'Assign transaction','data-kind="TRANSACTION"')+' '+button('assign-source',row.recipient,'Assign recipient','data-kind="RECIPIENT"')+' '+button('assign-source',row.funder,'Assign funder','data-kind="FUNDER"')+'</p></div>'+
    metrics([[row.carbon_amount,'CARBON contributed'],[row.allocated,'Allocated in this edition'],[row.remaining,'Remaining'],[readable(row.collectionStatus),'Retirement status']])+
    '<h3>Complete retirement allocations</h3>'+table([{label:'Certificate',render:item=>button('retirement',item.certificate_id,item.certificate_id)},{label:'Allocated CARBON',key:'amount_filled',number:true},{label:'Retirement date',render:item=>esc(displayDate(item.retirement.retirement_date))},{label:'Native completion flag',render:item=>String(item.finalized)},{label:'Beneficiary',render:item=>esc(item.retirement.retirement_beneficiary)}],row.allocations)+
    '<details><summary>Complete retained record</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>');
}
async function openRetirement(certificate){
  const row=await client.retirement(certificate,{editionId:selected().editionId});
  dialog('Retirement certificate '+certificate,'<dl><dt>Certificate</dt><dd>'+esc(row.certificate_id)+'</dd><dt>Retired</dt><dd>'+esc(displayDate(row.retirement_date))+'</dd><dt>Full VCU amount</dt><dd>'+esc(row.vcu_amount)+'</dd><dt>Beneficiary</dt><dd>'+esc(row.retirement_beneficiary)+'</dd><dt>Details</dt><dd>'+esc(row.retirement_details)+'</dd><dt>Serial number</dt><dd>'+esc(row.serial_number)+'</dd><dt>Impact project</dt><dd>'+esc(row.impactProject?.name||row.vcs_project_id)+'</dd><dt>Vintage</dt><dd>'+esc(displayDate(row.vintage_start))+' through '+esc(displayDate(row.vintage_end))+'</dd></dl>'+
    '<h3>Contributions filled by this certificate</h3>'+table([{label:'Contribution',render:item=>button('contribution',item.hash,item.hash.slice(0,12)+'…')},{label:'Created',render:row=>esc(displayDate(row.createdAt,true))},{label:'Customer',render:item=>esc(customerName(item.customerId))},{label:'Allocated CARBON',key:'amount',number:true}],row.allocations)+
    '<h3>Retired blocks</h3>'+table([{label:'Block',key:'block_hash'},{label:'VCU',key:'vcu_amount',number:true},{label:'Original block serial',render:item=>esc(item.block?.serial_number||'Available in the retained certificate source')}],row.blocks)+
    '<details><summary>Complete retained certificate</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>');
}
function statementEditor(spec={},statementId){
  const selection=selected(),last=ui.state.statements.find(row=>row.id===statementId)?.versions.length;
  dialog(statementId?'Revise statement':'Prepare statement','<form id="statement-form" data-id="'+esc(statementId||'')+'" data-version="'+(last||'')+'"><div class="form-grid">'+
    input('title','Statement title',spec.title,'text','required maxlength="300"')+'<label>Source edition<select name="editionId">'+options(ui.state.editions,spec.editionId||selection.editionId)+'</select></label>'+
    '<label>Customer<select name="customerId">'+options(ui.state.customers,spec.customerId??selection.customerId,'Whole portfolio')+'</select></label>'+
    '<label>Project<select name="projectId">'+options(ui.state.projects.filter(row=>!(spec.customerId??selection.customerId)||row.customerId===(spec.customerId??selection.customerId)),spec.projectId??selection.projectId,'All customer projects')+'</select></label>'+
    input('fromDate','From date',spec.fromDate||selection.fromDate,'date','required')+input('beforeDate','Before date',spec.beforeDate||selection.beforeDate,'date','required')+
    textarea('note','Statement note',spec.note)+'</div><p class="form-note">The period starts at From and stops before Before. Allocations reflect the source edition; the retirement register applies the same period to certificate dates.</p>'+
    '<div class="form-actions"><button type="button" data-action="preview-statement">Preview complete statement</button><button type="submit" class="primary" data-mutates>Save statement version</button></div></form><div id="statement-preview"></div>');
}
function reportMarkup(report){
  const frozenColumns=contributionColumns().filter(row=>row.label!=='Contribution').map(column=>column.label==='Customer / project'?{label:column.label,render:row=>esc(report.customerSnapshot?.find(item=>item.id===row.assignment.customerId)?.name||row.assignment.customerId||'Unassigned')+'<span class="secondary">'+esc(report.projectSnapshot?.find(item=>item.id===row.assignment.projectId)?.name||'—')+'</span>'}:column);
  return '<div class="editor-preview">'+metrics([[report.totals.carbon,'CARBON contributed'],[report.totals.allocated,'Allocated in source edition'],[report.totals.remaining,'Remaining'],[report.retirementTotals.attributedCarbon,'Retirement dated in this period']])+
    '<p>'+esc(displayDate(report.spec.fromDate))+' to before '+esc(displayDate(report.spec.beforeDate))+' · '+esc(report.customer?.name||'Whole portfolio')+'</p><p>'+esc(report.spec.note)+'</p>'+
    '<p class="form-note">'+esc(report.allocationDateBasis)+' '+esc(report.retirementDateBasis)+'</p>'+
    '<h3>Contributions</h3>'+table(frozenColumns.concat([{label:'Transaction',key:'hash'}]),report.contributions)+
    '<h3>Separately dated retirement register</h3>'+table(retirementColumns().map(column=>column.label==='Certificate'?{label:'Certificate',key:'certificate_id'}:column),report.retirements)+
    '<details><summary>All contribution allocations, including later certificate dates</summary>'+table([{label:'Transaction',key:'hash'},{label:'Certificate',key:'certificate_id'},{label:'CARBON',key:'amount_filled',number:true},{label:'Retirement date',render:row=>esc(displayDate(row.retirement_date))}],report.contributions.flatMap(row=>row.allocations.map(item=>({hash:row.hash,...item,retirement_date:item.retirement.retirement_date}))))+'</details>'+
    '<p class="form-note">Source-period records: '+report.coverage.sourcePeriodTransactions+'; unassigned: '+report.coverage.unassigned+'; conflicting assignments: '+report.coverage.conflictingAssignments+'.</p></div>';
}
async function openStatement(statementId,version){
  const report=await client.statement(statementId,version);ui.report=report;ui.statementId=statementId;
  const files=['statement.html','statement.json','contributions.csv','allocations.csv','retirements.csv'];
  dialog(report.spec.title+' · version '+report.version,'<div class="actions">'+files.map(name=>'<a class="button small" href="'+esc(client.statementFileUrl(statementId,report.version,name))+'">'+esc(name)+'</a>').join('')+
    button('revise-statement',statementId,'Revise statement')+(ui.state.integration.accounting&&report.customer?.merchantCustomerId?button('invoice',statementId,'Create / open service-fee invoice'):'')+'</div>'+reportMarkup(report));
}
function invoiceEditor(){
  const report=ui.report,statementId=ui.statementId;
  dialog('Invoice for '+report.spec.title,'<p>Create a service-fee draft in the original accounting customer. Enter the agreed fee and tax explicitly; original asset payment amounts remain in the statement.</p>'+
    '<form id="invoice-form" data-id="'+esc(statementId)+'"><div class="form-grid">'+input('statementVersion','Statement version',report.version,'number','readonly')+
    input('amount','Agreed service fee','','text','required inputmode="decimal"')+input('code','Currency code','','text','required pattern="[A-Z]{3}" maxlength="3"')+
    input('scale','Currency decimal places','','number','required min="0" max="6"')+input('issueDate','Invoice date','','date','required')+
    input('dueDate','Due date','','date','required')+input('taxAmount','Tax amount','0','text','inputmode="decimal"')+textarea('note','Invoice note',report.spec.note)+
    '</div><div class="form-actions"><button type="submit" class="primary" data-mutates>Create / recover original draft</button></div></form>');
}
async function openEdition(editionId){
  const source=await client.edition(editionId);
  dialog(source.label,'<dl><dt>Edition</dt><dd><code>'+esc(source.id)+'</code></dd><dt>Imported</dt><dd>'+esc(displayDate(source.importedAt,true))+'</dd><dt>Format</dt><dd>'+esc(readable(source.format))+'</dd><dt>Source identity</dt><dd><code>'+esc(source.sha256)+'</code></dd></dl>'+
    '<h3>All native tables</h3>'+table([{label:'Table',render:row=>esc(tableTitles[row.id])},{label:'Rows',key:'count',number:true},{label:'',render:row=>button('source-table',editionId,'Open complete table','data-table="'+row.id+'"')}],tables.map(id=>({id,count:source.counts[id]})))+
    '<h3>Original files and responses</h3><div class="source-list">'+source.files.map(row=>'<a href="'+esc(row.url)+'">'+esc(row.name)+'</a>').join('')+
    source.responses.map(row=>'<a href="'+esc(row.file)+'">'+esc(row.url)+' · '+esc(displayDate(row.retrievedAt,true))+'</a>').join('')+'</div>'+
    '<details open><summary>Source metadata</summary><pre>'+esc(JSON.stringify(source.metadata,null,2))+'</pre></details>');
}
async function sourceTable(editionId,tableName,offset=0){
  const result=await client.table(editionId,tableName,{offset,limit:100});ui.table={editionId,tableName};ui.tableOffset=offset;
  dialog(tableTitles[tableName],table(result.columns.map(key=>({label:key,key})),result.items)+
    '<div class="pagination"><span>Rows '+(result.items.length?offset+1:0)+'–'+(offset+result.items.length)+' of '+result.total+'</span><div class="actions">'+
    '<button data-action="table-previous" type="button"'+(!offset?' disabled':'')+'>Previous</button><button data-action="table-next" type="button"'+(result.nextOffset===null?' disabled':'')+'>Next</button></div></div>');
}
function renderComparison(){
  const report=ui.comparison,target=$('#comparison-result');if(!target||!report)return;
  const summary=tables.map(id=>({id,...report.tables[id].counts})),changes=report.tables[ui.comparisonTable];
  const rows=[...changes.added.map(row=>({...row,kind:'ADDED'})),...changes.removed.map(row=>({...row,kind:'REMOVED'})),...changes.changed.map(row=>({...row,kind:'CHANGED'}))];
  const start=ui.comparisonPage*50;
  target.innerHTML=metrics([[report.delta.carbon,'Change in contributed CARBON'],[report.delta.allocated,'Change in allocated CARBON'],[report.delta.remaining,'Change in remaining CARBON'],[rows.length,'Changes in the selected table']])+
    '<div class="actions"><a class="button" href="/api/compare?beforeId='+encodeURIComponent(report.beforeId)+'&afterId='+encodeURIComponent(report.afterId)+'&format=csv">Export every change as CSV</a>'+button('download-comparison','','Export complete comparison JSON')+'</div><h3>Native table populations</h3>'+
    table([{label:'Table',render:row=>button('compare-table',row.id,tableTitles[row.id])},{label:'Before',key:'before',number:true},{label:'After',key:'after',number:true},{label:'Added',key:'added',number:true},{label:'Removed',key:'removed',number:true},{label:'Changed',key:'changed',number:true}],summary)+
    '<h3>'+esc(tableTitles[ui.comparisonTable])+'</h3>'+table([{label:'Change',render:row=>badge(row.kind)},{label:'Native key',key:'key'},{label:'Full record and field changes',render:row=>'<details><summary>Open complete change</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>'}],rows.slice(start,start+50))+
    '<div class="pagination"><span>'+Math.min(start+1,rows.length)+'–'+Math.min(start+50,rows.length)+' of '+rows.length+' changes</span><div class="actions"><button data-action="compare-previous"'+(!ui.comparisonPage?' disabled':'')+'>Previous</button><button data-action="compare-next"'+(start+50>=rows.length?' disabled':'')+'>Next</button></div></div>';
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function updateCapture(continuePolling=true){
  const value=await client.captureStatus(),node=$('#capture-status');
  if(node)node.textContent=readable(value.status)+' · '+value.pages+' original responses retained'+(value.error?' · '+value.error.message:'');
  if(value.status==='RUNNING'){
    clearTimeout(ui.captureTimer);ui.captureTimer=setTimeout(()=>updateCapture().catch(error=>notice(error.message,true)),2000);
  }else if(value.status==='COMPLETE'&&continuePolling){
    clearTimeout(ui.captureTimer);await refresh();notice('Complete native API edition received.');
  }
}
document.addEventListener('change',event=>{
  const input=event.target,form=input.form;
  if(input.name!=='customerId'||!form||!['assignment-form','statement-form'].includes(form.id))return;
  const projects=ui.state.projects.filter(row=>row.customerId===input.value||(!input.value&&form.id==='statement-form'));
  form.elements.projectId.innerHTML=options(projects,'',form.id==='assignment-form'?'No project':'All customer projects');
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement))return;
  event.preventDefault();
  perform(async()=>{
    const value=values(form),recordId=form.dataset.id;
    if(form.id==='contribution-filter'||form.id==='retirement-filter'){
      if(form.id==='contribution-filter')ui.contributionFilter=value;else ui.retirementFilter=value;
      resetPage();await render();
    }else if(['customer-form','project-form','assignment-form'].includes(form.id)){
      const action=form.id.replace('-form','');
      if(recordId){value.id=recordId;value.expectedVersion=Number(form.dataset.version);}
      if(action==='assignment')value.active=form.elements.active.checked;
      await client.apply(action,value,operation());close();await refresh();notice('Saved '+action+'.');
    }else if(form.id==='statement-form'){
      if(recordId){value.id=recordId;value.expectedVersion=Number(form.dataset.version);}
      const result=await client.apply('statement',value,operation());await refresh();await openStatement(result.statementId,result.version.version);notice('Complete statement version saved.');
    }else if(form.id==='compare-form'){
      ui.comparison=await client.compare(value.beforeId,value.afterId);ui.comparisonPage=0;renderComparison();
    }else if(form.id==='import-form'){
      const files={},metadata={};for(const selectedFile of form.elements.files.files){
        if(selectedFile.name==='manifest.json')Object.assign(metadata,JSON.parse(await selectedFile.text()));
        else if(selectedFile.name.endsWith('.ndjson'))files[selectedFile.name.slice(0,-7)]=await selectedFile.text();
      }
      await client.import(files,metadata,value.label,operation());await refresh();notice('Complete native source edition received.');
    }else if(form.id==='capture-form'){
      const {label,...capture}=value;capture.resume=form.elements.resume.checked;
      await client.capture(capture,label,operation());notice('Native source acquisition started. Completed pages are retained for resume.');await updateCapture();
    }else if(form.id==='invoice-form'){
      const payload={...value,statementVersion:Number(value.statementVersion),currency:{code:value.code,scale:Number(value.scale)}};
      delete payload.code;delete payload.scale;
      const result=await client.invoice(recordId,payload,operation());await refresh();
      dialog('Original invoice draft','<p>Statement '+esc(recordId)+' is linked to original invoice <code>'+esc(result.invoice.invoiceId)+'</code>.</p>'+
        '<p>Continue the existing invoice review and issue workflow, then prepare customer installments in Payment plans.</p><div class="actions"><a class="button primary" href="/receivables/">Open invoices</a><a class="button" href="/payment-plans/">Open payment plans</a></div>');
    }else if(form.id==='receive-form'){
      const handover=JSON.parse(await form.elements.handover.files[0].text());
      const result=await client.request('/receive',{method:'POST',body:{directory:value.directory,handover,...operation()}});
      $('#receive-result').innerHTML='<p>Received the complete workspace in <code>'+esc(result.directory)+'</code>.</p><a class="button primary" href="'+esc(result.url)+'" target="_blank" rel="noopener">Open received workspace</a>';
    }
  });
});
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action,recordId=target.dataset.id;
  perform(async()=>{
    if(action==='go-capture'||action==='go-assignments'||action==='go-customers'){ui.tab=action.slice(3);resetPage();close();await render();}
    else if(action==='new-customer')await customerEditor();
    else if(action==='edit-customer')await customerEditor(ui.state.customers.find(row=>row.id===recordId));
    else if(action==='new-project')projectEditor();
    else if(action==='edit-project')projectEditor(ui.state.projects.find(row=>row.id===recordId));
    else if(action==='new-assignment')assignmentEditor();
    else if(action==='edit-assignment')assignmentEditor(ui.state.assignments.find(row=>row.id===recordId));
    else if(action==='assign-source')assignmentEditor({kind:target.dataset.kind,value:recordId});
    else if(action==='contribution')await openContribution(recordId);
    else if(action==='retirement')await openRetirement(recordId);
    else if(action==='new-statement')statementEditor();
    else if(action==='preview-statement'){const form=$('#statement-form');if(!form.reportValidity())return;const report=await client.preview(values(form),operation());$('#statement-preview').innerHTML=reportMarkup(report);}
    else if(action==='statement')await openStatement(recordId,Number(target.dataset.version));
    else if(action==='revise-statement')statementEditor(ui.report.spec,recordId);
    else if(action==='invoice')invoiceEditor();
    else if(action==='edition')await openEdition(recordId);
    else if(action==='source-table')await sourceTable(recordId,target.dataset.table);
    else if(action==='table-previous')await sourceTable(ui.table.editionId,ui.table.tableName,Math.max(0,ui.tableOffset-100));
    else if(action==='table-next')await sourceTable(ui.table.editionId,ui.table.tableName,ui.tableOffset+100);
    else if(action==='next-page'){ui.previous.push(ui.cursor);ui.cursor=target.dataset.cursor;await render();}
    else if(action==='previous-page'){ui.cursor=ui.previous.pop()||null;await render();}
    else if(action==='compare-table'){ui.comparisonTable=recordId;ui.comparisonPage=0;renderComparison();}
    else if(action==='compare-previous'){ui.comparisonPage--;renderComparison();}
    else if(action==='compare-next'){ui.comparisonPage++;renderComparison();}
    else if(action==='download-comparison')download('stellarcarbon-comparison.json',ui.comparison);
    else if(action==='import-retained'){await client.request('/import',{method:'POST',body:{retained:true,label:'Original sc-data d7c10873 · records through 2026-03-03',...operation()}});await refresh();notice('All seven original native tables received.');}
  });
});
$('#navigation').addEventListener('click',event=>{const tab=event.target.closest('[data-tab]');if(tab)perform(async()=>{ui.tab=tab.dataset.tab;resetPage();await render();});});
$('#refresh').addEventListener('click',()=>perform(()=>refresh()));
$('#close-dialog').addEventListener('click',close);
$('#apply-filters').addEventListener('click',()=>perform(async()=>{resetPage();await render();}));
$('#clear-filters').addEventListener('click',()=>perform(async()=>{ui.contributionFilter={};ui.retirementFilter={};$('#customer').value='';$('#project').value='';$('#from-date').value='';$('#before-date').value='';resetPage();await render();}));
$('#edition').addEventListener('change',()=>perform(async()=>{resetPage();await render();}));
$('#customer').addEventListener('change',()=>{$('#project').innerHTML=options(ui.state.projects.filter(row=>!$('#customer').value||row.customerId===$('#customer').value),'','All projects');});
perform(()=>refresh());
