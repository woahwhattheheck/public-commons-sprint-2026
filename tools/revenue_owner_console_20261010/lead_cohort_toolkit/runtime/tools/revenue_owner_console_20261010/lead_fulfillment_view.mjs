import {renderLeadProcurementPanel} from './lead_procurement_view.mjs';
import {renderLeadCustomerRequestsPanel} from './lead_customer_request_view.mjs';
import {renderLeadCustomerFilesPanel} from './lead_customer_file_view.mjs';
import {renderLeadReconciliationPanel} from './lead_reconciliation_view.mjs';
import {renderCreatorProgrammePanel} from './creator_programme_view.mjs';
import {renderCreatorMeasurementPanel} from './creator_programme_measurement_panel.mjs';
/** Lead fulfillment operator screen and customer editions. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const line=(name,label,type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
const area=(name,label,rows=3,extra='')=>'<label>'+label+'<textarea name="'+name+'" rows="'+rows+'" '+extra+'></textarea></label>';
const select=(name,label,options)=>'<label>'+label+'<select name="'+name+'">'+options.map(([value,text])=>'<option value="'+value+'">'+text+'</option>').join('')+'</select></label>';
const kinds=[['paid_request','Published paid request'],['problem_signal','Published problem'],['company_fit','Company that fits the brief']];
const statuses=[['unconfirmed','Availability unconfirmed'],['open','Open'],['closed','Closed'],['expired','Expired'],['excluded','Excluded']];
export function renderLeadFulfillmentPage({csrf}={}){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="dealscout-token" content="'+esc(csrf)+'"><title>Lead fulfillment · DealScout</title>'+
    '<link rel="stylesheet" href="/lead_fulfillment.css"><link rel="stylesheet" href="/creator_programme_workbook.css"><link rel="stylesheet" href="/creator_programme/commercial.css"><link rel="stylesheet" href="/lead_customer_requests.css"><link rel="stylesheet" href="/creator_programme/operating_desk.css"></head><body><a class="skip" href="#main">Skip to lead fulfillment</a>'+
    '<header><div><p class="eyebrow">DealScout / Revenue</p><h1>Lead fulfillment</h1>'+
    '<p>Prepare a useful sample, assemble a paid pack, and carry its scope, delivery and collection in the original customer case.</p></div>'+
    '<nav aria-label="Workspace"><a href="/">Owner queue</a><a href="/deal">Commercial work</a><a href="/referrals">Partnerships</a><a href="/lead-sources">Source review</a><a href="/lead-collection">Collection intake</a><a href="/portfolio">Portfolio opportunities</a><a href="/workspace">Workspace transfer</a><a href="/lead-packs/portable-delivery.html" download>Portable delivery receiving</a></nav></header>'+
    '<main id="main"><div id="message" class="notice" role="status" aria-live="polite">Opening the sales workspace…</div>'+
    '<section id="recovery" hidden aria-labelledby="recovery-title"><h2 id="recovery-title">Continue your saved request</h2>'+
    '<p id="pending-description"></p><p id="pending-error"></p><div class="actions">'+
    '<button id="resume-save" type="button">Resume original save</button><button id="download-request" type="button">Download saved request</button>'+
    '<button id="review-request" type="button" hidden>Review rejected request</button></div>'+
    '<form id="rework-form" hidden><p>The current workspace is shown below. Review the complete input, then save the revised request.</p>'+
    area('input','Complete operation input',12,'required spellcheck="false"')+
    '<button type="submit">Save reviewed request</button></form></section>'+
    '<section aria-labelledby="packs-title"><div class="section-heading"><h2 id="packs-title">Customer packs</h2><div class="actions">'+
    '<button id="new-pack" type="button">New customer brief</button><a id="workspace-record" download>Download all team records</a><button id="refresh" type="button">Refresh workspace</button></div></div>'+
    '<div class="filters customer-filters"><label>Find a customer or brief<input id="pack-search" type="search" placeholder="Customer, pack title or ID"></label>'+
    '<label>Show<select id="pack-filter"><option value="all">All customers</option><option value="attention">Delivery needs attention</option><option value="unprepared">No prepared edition</option></select></label>'+
    '<label>Order<select id="pack-sort"><option value="updated">Recently updated</option><option value="customer">Customer name</option><option value="attention">Delivery attention first</option></select></label></div>'+
    '<div class="review-paging"><p id="pack-results-summary" class="muted" role="status"></p><div class="actions"><button id="pack-previous-page" type="button">Previous page</button><button id="pack-next-page" type="button">Next page</button></div></div>'+
    '<div class="table-wrap"><table><caption class="sr-only">Saved customer briefs and prepared packs</caption><thead><tr><th>Customer / brief</th><th>Paid offer</th><th>Leads / editions</th><th>Updated</th><th></th></tr></thead><tbody id="packs"></tbody></table></div>'+
    '<details id="receive-panel"><summary>Receive customer records and files</summary><p>Bring one customer or a complete team workspace into this workspace. Review every customer, matching newer revision, capture and delivery history together. A workspace copy saves as one operation. Current local work stays in place; conflicting edits are listed before saving.</p>'+
    '<form id="receive-form"><label>Complete record or source document<input name="file" type="file" accept=".json,.md,.txt,.gz,application/json,text/markdown,text/plain,application/gzip,application/x-gzip"></label>'+
    area('json','Complete JSON or source document',10,'spellcheck="false"')+
    '<p>Choose a customer record, workspace copy, or the complete document carrying its files. JSON, Markdown and their gzip copies are supported.</p>'+
    '<details><summary>Select a record within a document</summary>'+line('record_path','Original working record path','text','placeholder="working-record.json"')+'</details>'+
    '<button id="preview-receive" type="button">Review incoming records</button>'+
    '<div id="receive-preview" aria-live="polite"></div><button type="submit" disabled id="receive-button">Receive records</button>'+ 
    '<button id="retain-reconciliation" type="button" hidden>Retain both copies for reconciliation</button></form></details></section>'+renderLeadReconciliationPanel()+
    '<nav class="customer-review-navigation" aria-label="Customer review"><p id="review-customer-position" class="muted"></p><div class="actions">'+
    '<button id="review-results" type="button">Return to customer list</button><button id="review-previous-customer" type="button">Previous customer</button><button id="review-next-customer" type="button">Next customer</button></div></nav>'+
    '<section id="brief-panel" hidden aria-labelledby="brief-title"><div class="section-heading"><h2 id="brief-title">Customer brief</h2>'+
    '<div class="actions"><a id="capture-workspace" href="/lead-captures">Prepare and review captures</a><a id="production-workspace" target="_blank" rel="noopener" hidden>Open production worksheet</a><a id="production-history" target="_blank" rel="noopener" hidden>Saved production worksheets</a><span id="production-empty" class="muted" hidden>Prepare an active paid edition to plan its production.</span><a id="working-record" download>Download team working record</a><button id="close-brief" type="button">Close brief</button></div></div>'+
    '<p id="brief-edition" class="muted"></p><form id="brief-form"><fieldset><legend>Customer</legend><div class="grid">'+
    line('id','Pack ID','text','required maxlength="160" pattern="[A-Za-z0-9][A-Za-z0-9._:\\-]*"')+
    line('customer_name','Customer name','text','required maxlength="240" autocomplete="organization"')+
    line('company_domain','Customer company domain','text','maxlength="253" placeholder="company.example"')+
    line('contact_url','Customer contact route','text','maxlength="4000" placeholder="https://… or mailto:… or tel:+…"')+
    line('case_id','Existing company case ID','text','maxlength="160"')+
    line('prospect_id','Existing prospect ID','text','maxlength="160"')+'</div></fieldset>'+
    '<fieldset><legend>Requested leads and offer</legend>'+line('title','Pack title','text','required maxlength="300"')+
    area('description','Customer criteria',4,'required maxlength="8000"')+
    '<div class="grid">'+line('geography','Geography','text','maxlength="1000"')+
    select('lead_kind','Type of lead requested',[['any','Any of the stated lead types'],...kinds])+
    line('sample_quantity','Leads in the free sample','number','min="1" max="500" step="1" value="5" aria-describedby="sample-quantity-help"')+
    line('quantity','Additional leads in a paid pack','number','min="1" max="500" step="1" required value="5"')+
    line('currency','Currency','text','required maxlength="3" pattern="[A-Za-z]{3}" value="USD"')+
    line('price','Paid pack price','text','inputmode="decimal" required value="20.00"')+
    line('max_age_days','Maximum source age, days','number','min="0" max="3660" step="1" value="0" required')+'</div>'+
    '<p id="sample-quantity-help" class="muted">New briefs start with five free leads. A blank free-sample quantity preserves the legacy one-lead default. Enter 1–500 to declare another quantity; saved earlier editions keep their original selection.</p>'+
    '<p id="offer-summary" class="muted">The free sample uses its declared quantity. Paid and complimentary full packs use the separate full-pack quantity. Requests use their original date; company-fit sources use their checked date. An age limit of 0 accepts any date.</p>'+
    area('skills','Skills or services, one per line',3,'maxlength="16000"')+
    '<div class="grid">'+area('excluded_domains','Excluded company domains, one per line',3)+area('excluded_sources','Excluded original request URLs, one per line',3)+'</div>'+
    area('exclusions','Other customer exclusions',3,'maxlength="8000"')+'</fieldset>'+
    '<fieldset><legend>Team notes</legend>'+area('operator_note','Internal brief note',3,'maxlength="12000"')+'</fieldset>'+
    '<div class="actions"><button type="submit">Save customer brief</button><span id="brief-dirty" class="muted"></span></div></form></section>'+
    '<section id="case-link-panel" hidden aria-labelledby="case-link-title"><div class="section-heading"><h2 id="case-link-title">Sales case</h2>'+
    '<div class="actions"><a id="case-link-open" hidden>Open sales case</a><button id="case-link-start" type="button">Prepare sales case</button></div></div>'+
    '<p>Connect this research and its customer selections to the company’s original sales case.</p>'+
    '<p id="case-link-status" class="muted" aria-live="polite"></p>'+
    '<form id="case-link-form" hidden><fieldset><legend>Company and relationship</legend><div class="grid">'+
    select('case_id','Existing case',[['','Find the original case or prepare a new one']])+
    line('company_url','Company website','url','required maxlength="4096"')+
    line('existing_owner','Responsible operator','text','required maxlength="200"')+
    line('service_name','Service name','text','required maxlength="200"')+
    line('service_url','Service or offer source','url','required maxlength="4096"')+'</div></fieldset>'+
    '<fieldset><legend>Reviewed company source</legend><div class="grid">'+
    line('source_url','Original source','url','required maxlength="4096"')+
    line('source_observed_at','Source checked','datetime-local','required step="0.001"')+'</div></fieldset>'+
    '<div class="actions"><button id="case-link-preview" type="button">Review case and work</button>'+
    '<button id="case-link-cancel" type="button">Close</button></div>'+
    '<div id="case-link-review" aria-live="polite"></div>'+
    '<button id="case-link-save" type="submit" disabled>Save and open sales case</button></form></section>'+
    '<section id="leads-panel" hidden aria-labelledby="leads-title"><div class="section-heading"><h2 id="leads-title">Lead records</h2>'+
    '<button id="new-lead" type="button">Add lead</button></div>'+
    '<div class="filters"><label>Find a lead<input id="lead-search" type="search" placeholder="Buyer, request, geography or tag"></label>'+
    '<label>Show<select id="lead-filter"><option value="all">All leads</option><option value="ready">Available for a new pack</option><option value="incomplete">Needs completion</option><option value="used">Already prepared for this customer</option></select></label></div>'+
    '<div class="table-wrap"><table><caption class="sr-only">Original buyer requests and current preparation status</caption><thead><tr><th>Select</th><th>Buyer / request</th><th>Source / dates</th><th>Preparation</th><th></th></tr></thead><tbody id="leads"></tbody></table></div>'+
    '<details id="complimentary-inclusion"><summary>Include earlier editions in a complimentary full pack</summary>'+
    '<p>Choose each earlier edition explicitly. Every lead from those editions stays selected and uses its current reviewed research. The new pack has the full brief quantity at zero price. Original editions, prices and delivery records remain unchanged.</p>'+
    '<div id="complimentary-inclusion-list"></div></details>'+
    '<div class="selection-bar"><p id="selection-summary" aria-live="polite">Select leads for the next customer edition.</p><div class="actions">'+
    '<button id="prepare-sample" type="button" disabled>Prepare free sample</button><button id="prepare-paid" type="button" disabled>Prepare paid pack</button><button id="prepare-complimentary" type="button" disabled>Prepare complimentary full pack</button>'+
    '<button id="clear-selection" type="button">Clear selection</button></div></div>'+
    '<details id="import-panel"><summary>Import or update lead records from JSON</summary>'+
    '<p>Use an array of lead records, or an object with a leads array. Keep an existing lead ID to save its next revision. New rows can omit IDs.</p>'+
    '<form id="import-form"><label>Lead file (JSON or gzip)<input name="file" type="file" accept=".json,.gz,application/json,application/gzip,application/x-gzip"></label>'+
    area('json','Complete lead JSON',10,'spellcheck="false"')+
    '<div class="actions"><button id="preview-import" type="button">Review import</button><button id="save-import" type="submit" disabled>Save reviewed lead records</button></div>'+
    '<div id="import-preview" aria-live="polite"></div></form></details></section>'+
    '<section id="lead-editor" hidden aria-labelledby="lead-editor-title"><div class="section-heading"><h2 id="lead-editor-title">Lead record</h2>'+
    '<button id="close-lead" type="button">Close record</button></div><p id="lead-edition" class="muted"></p><form id="lead-form">'+
    '<fieldset><legend>Buyer and original request</legend><div class="grid">'+
    line('id','Lead ID','text','required maxlength="160" pattern="[A-Za-z0-9][A-Za-z0-9._:\\-]*"')+
    line('organization','Company or buyer name','text','maxlength="400"')+line('person','Published contact name','text','maxlength="240"')+
    line('company_domain','Company domain','text','maxlength="253"')+line('company_url','Company website','url','maxlength="4000"')+
    line('buyer_key','Original buyer account or identity','text','maxlength="600"')+'</div>'+
    line('source_url','Original source URL','url','maxlength="4000"')+
    '<div class="grid">'+line('published_on','Original request date','date')+line('author_updated_on','Last buyer update date','date')+
    select('lead_kind','Source signal',kinds)+'</div>'+
    area('demand','What the buyer needs',4,'maxlength="8000"')+area('fit','Why this matches the customer brief',4,'maxlength="8000"')+'</fieldset>'+
    '<fieldset><legend>Source availability and contact</legend><div class="grid">'+select('source_status','Current source status',statuses)+
    line('checked_at','Source checked','datetime-local','step="0.001"')+
    '<label class="check-label"><input name="checked_date_only" type="checkbox">Source check recorded as a date only</label>'+
    line('deadline_on','Published deadline date','date')+line('deadline_at','Exact deadline, local time','datetime-local','step="0.001"')+'</div>'+
    '<div class="actions"><button id="checked-now" type="button">Source checked just now</button><span class="muted">For requests, use the original publication date even after a buyer update. For an undated company page, leave it blank and record when you checked the source. An exact deadline takes precedence over the date.</span></div>'+
    '<div class="grid">'+line('observed_publication_label','Original relative publication label','text','maxlength="1000" placeholder="Posted 2 days ago"')+
    line('observed_closing_label','Original relative closing label','text','maxlength="1000" placeholder="Ends in 6 days"')+'</div>'+
    '<div class="grid">'+line('observed_source_url','Observed source URL','url','readonly maxlength="4000"')+
    line('observed_checked_at','Observed source check','text','readonly maxlength="40"')+'</div>'+
    '<div class="actions"><button id="bind-source-time" type="button">Use current source check for these labels</button>'+
    '<button id="clear-source-time" type="button">Remove relative time observation</button></div>'+
    '<p class="muted">Copy the complete labels from the original page, then bind them to the source URL and check time above. Changing the source or check time requires a new observation. A supported original publication label can satisfy the age limit using its full age window. Open paid requests need today’s source check; elapsed closing intervals require a fresh check. English and Spanish minute, hour, day and week labels are supported. Leave unpublished calendar dates empty.</p>'+
    area('status_note','Availability and deadline context',3,'maxlength="8000"')+
    line('contact_url','Published contact route','text','maxlength="4000" placeholder="https://… or mailto:… or tel:+…"')+
    area('contact_instructions','How the buyer asks to be contacted',3,'maxlength="8000"')+
    '<div class="grid">'+line('geography','Lead geography','text','maxlength="1000"')+line('budget','Published budget','text','maxlength="1000"')+'</div>'+
    area('opening_message','Suggested opening message for the customer',5,'maxlength="12000"')+'</fieldset>'+
    '<fieldset><legend>Team organization</legend>'+area('tags','Tags, one per line',2)+area('operator_note','Internal lead note',3,'maxlength="12000"')+'</fieldset>'+
    '<div class="actions"><button type="submit">Save complete lead record</button><span id="lead-dirty" class="muted"></span></div></form>'+
    '<details id="lead-history"><summary>Earlier saved revisions</summary><div id="lead-history-list"></div></details></section>'+
    '<section id="editions-panel" hidden aria-labelledby="editions-title"><h2 id="editions-title">Prepared customer editions</h2>'+
    '<p>Each edition keeps the exact brief and lead records selected when it was prepared. Download its customer ZIP for the readable brief, spreadsheet, complete customer data and start instructions. After sharing it, attach the actual delivery to that edition below.</p><div id="editions"></div></section>'+
    '<section id="commerce-panel" hidden aria-labelledby="commerce-title"><div class="section-heading"><h2 id="commerce-title">Commercial scope for the paid pack</h2>'+
    '<button id="close-commerce" type="button">Close commercial scope</button></div>'+
    '<p id="commerce-edition"></p><p id="commerce-criteria" class="muted"></p>'+
    '<form id="commerce-form"><input name="edition_id" type="hidden"><input name="previous_id" type="hidden">'+
    '<div class="grid"><label>Original company case<select name="case_id" required></select></label>'+
    '<label>Scope revision<select name="scope_id"><option value="">Prepare a new proposed scope</option></select></label></div>'+
    '<p id="commerce-case" class="muted" aria-live="polite"></p><p id="commerce-scope" class="muted"></p>'+
    '<fieldset id="commerce-terms"><legend>Proposed terms</legend><div class="grid">'+
    line('title','Scope title','text','required maxlength="200"')+
    line('customer','Contracting customer','text','required maxlength="240"')+
    line('supplier','Supplier','text','maxlength="240"')+'</div>'+
    area('schedule','Delivery schedule and clock-start event',3,'maxlength="8000"')+
    area('payment_terms','Payment terms',3,'maxlength="8000"')+
    area('dependencies','Customer inputs and dependencies',3,'maxlength="8000"')+
    area('exclusions','Scope exclusions',3,'maxlength="8000"')+
    area('rights','Use and ownership terms',3,'maxlength="8000"')+
    area('change_process','Correction and replacement process',3,'maxlength="8000"')+'</fieldset>'+
    '<label id="commerce-reason-label" hidden>Reason for changing the scope link<textarea name="reason" rows="3" maxlength="4000"></textarea></label>'+
    '<button id="save-commerce" type="submit">Save scope in the original case</button></form></section>'+
    '<section id="case-delivery-panel" hidden aria-labelledby="case-delivery-title"><div class="section-heading"><h2 id="case-delivery-title">Keep the original delivery in its case</h2>'+
    '<button id="close-case-delivery" type="button">Close delivery link</button></div>'+
    '<p id="case-delivery-description"></p><form id="case-delivery-form"><input name="delivery_id" type="hidden">'+
    line('evidence_url','Original delivery source','url','required maxlength="4000"')+
    '<button type="submit">Attach original delivery to the case</button></form></section>'+
    '<section id="replacement-panel" hidden aria-labelledby="replacement-title"><h2 id="replacement-title">Replace leads in a paid or complimentary pack</h2>'+
    '<form id="replacement-form"><label>Original paid or complimentary pack, or latest replacement<select name="replaces" required></select></label>'+
    '<p>Choose each original lead, its replacement, and the reason. The resulting customer edition retains every other lead. Its complete ZIP explains the changed companies and includes the full updated selection. A complimentary lineage remains zero-price and does not create a commercial scope or invoice.</p>'+
    '<div id="replacement-rows"></div><button id="add-replacement" type="button">Add replacement</button>'+
    '<div id="replacement-preview" class="muted"></div><button type="submit">Prepare complete replacement pack</button></form></section>'+
    '<section id="delivery-panel" hidden aria-labelledby="delivery-title"><h2 id="delivery-title">Record an actual delivery</h2>'+
    '<form id="delivery-form"><div class="grid"><label>Prepared customer edition<select name="edition_id" required></select></label>'+
    '<label>Complete customer package<select name="customer_package_id"><option value="">Original lead edition files</option></select></label>'+
    line('delivered_at','Delivered at, local time','datetime-local','step="0.001" required')+
    line('channel','Delivery channel','text','required maxlength="120" placeholder="Email, Slack, shared file…"')+
    line('destination','Actual recipient or destination','text','required maxlength="1000"')+
    line('provider_id','Sent message or file ID','text','required maxlength="500"')+
    '<label>Follows an earlier delivery<select name="previous_delivery_id"><option value="">First or separate delivery</option></select></label>'+
    line('receipt_url','Link to the actual delivery','url','maxlength="4000"')+'</div>'+
    area('note','Internal delivery note',3,'maxlength="4000"')+
    '<div id="delivery-commerce" hidden><label class="check-label"><input name="attach_to_case" type="checkbox">Keep this delivery in its original commercial case</label>'+
    '<p id="delivery-commerce-case" class="muted"></p></div><button type="submit">Save delivery record</button></form></section>'+
    '<section id="delivery-followup-panel" hidden aria-labelledby="delivery-followup-title"><div class="section-heading">'+
    '<h2 id="delivery-followup-title">Link an already recorded send</h2><button id="close-delivery-followup" type="button">Close delivery link</button></div>'+
    '<p id="delivery-followup-description"></p><form id="delivery-followup-form"><input name="previous_delivery_id" type="hidden">'+
    '<label>Later recorded delivery<select name="delivery_id" required></select></label>'+
    area('note','How this send follows the earlier attempt',3,'required maxlength="4000"')+
    '<p>Review both original delivery records, then save their connection in this customer’s history.</p>'+
    '<button type="submit">Link recorded deliveries</button></form></section>'+
    '<section id="delivery-feedback-panel" hidden aria-labelledby="delivery-feedback-title"><h2 id="delivery-feedback-title">Receive a delivery report</h2>'+
    '<p>Open the mail provider’s complete delivery notice and original sent message. Review which saved customer delivery each recipient outcome belongs to.</p>'+
    '<form id="delivery-feedback-form"><div class="grid">'+
    line('mailbox','Sending mailbox','email','required maxlength="320" autocomplete="email"')+
    '<label>Delivery notice JSON or gzip<input name="report_files" type="file" accept=".json,.gz,application/json,application/gzip" multiple></label>'+
    '<label>Original sent message JSON or gzip<input name="sent_files" type="file" accept=".json,.gz,application/json,application/gzip" multiple></label></div>'+
    '<details><summary>Paste complete provider messages</summary>'+
    area('reports_json','Delivery notices: complete message or JSON array',6)+
    area('sent_json','Original sent messages: complete message or JSON array',6)+
    '<p class="muted">Gmail attachment-policy notices require both complete original messages. Standard delivery reports can also use the original case’s retained native sent identity.</p></details>'+
    '<div class="actions"><button id="preview-delivery-feedback" type="button">Review delivery report</button>'+
    '<button id="save-delivery-feedback" type="submit" disabled>Save delivery feedback</button></div>'+
    '<div id="delivery-feedback-preview" class="notice" aria-live="polite">Choose the complete messages to review their saved delivery.</div></form></section>'+
    '<section id="withdraw-panel" hidden aria-labelledby="withdraw-title"><h2 id="withdraw-title">Withdraw a prepared edition</h2>'+
    '<p>Withdraw an edition before delivery to release its lead selection for a corrected pack.</p><form id="withdraw-form">'+
    '<label>Prepared edition<select name="edition_id" required></select></label>'+area('reason','Reason for withdrawal',3,'required maxlength="4000"')+
    '<button type="submit">Withdraw this edition</button></form></section>'+
    renderLeadCustomerFilesPanel()+renderLeadCustomerRequestsPanel()+renderLeadProcurementPanel()+renderCreatorProgrammePanel()+renderCreatorMeasurementPanel()+
    '<section id="creator-operating-panel" class="panel" hidden aria-label="Creator operating programme"></section>'+'<section id="creator-workbook-panel" hidden></section><section id="creator-commercial-pane" aria-label="Creator service billing"></section>'+
    '</main><footer><p id="workspace-edition"></p><p>Customer files contain the prepared lead information. Team working records also retain editable records, notes and delivery history.</p></footer>'+
    '<script type="module" src="/lead_fulfillment.js"></script></body></html>';
}
const KIND={sample:'Free sample',paid:'Paid lead pack',complimentary:'Complimentary full pack',replacement:'Replacement pack'};
const SIGNAL={paid_request:'Published paid request',problem_signal:'Published problem',company_fit:'Company that fits the brief'};
const STATUS={open:'Open',unconfirmed:'Availability unconfirmed',closed:'Closed',expired:'Expired',excluded:'Excluded'};
function sourceStatus(lead){
  const kind=lead.signal_type||lead.lead_kind;
  if(kind==='company_fit'&&['open','unconfirmed'].includes(lead.source_status)){
    return lead.source_checked_at||lead.checked_at?'Company source reviewed':'Company source';
  }
  return STATUS[lead.source_status]||lead.source_status||'';
}

function href(value,mail=false){
  const s=String(value??'');
  if(mail&&/^mailto:[^@\s<>?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))return s;
  if(mail&&/^tel:\+[1-9]\d{1,14}(?:;ext=\d{1,10})?$/i.test(s))return s.toLowerCase();
  const m=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(s);
  return m&&!m[2].includes('..')&&(!m[3]||Number(m[3])<=65535)?s:'';
}
function link(value,mail=false){const url=href(value,mail);const label=mail&&/^mailto:/i.test(url)?url.slice(7):mail&&url.startsWith('tel:')?url.slice(4).replace(';ext=',' ext. '):value;return url?'<a href="'+esc(url)+'" rel="noopener noreferrer">'+esc(label)+'</a>':esc(value);}
function pair(label,value){return value?'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>':'';}
function sourceTimePairs(observation){
  if(!observation)return '';
  return pair('Original relative publication label',observation.publication_label)+
    pair('Original relative closing label',observation.closing_label)+
    pair('Labels observed',dateLabel(observation.checked_at))+
    '<dt>Observed source</dt><dd>'+link(observation.source_url)+'</dd>';
}
function money(minor,currency){
  try{const options=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions();return new Intl.NumberFormat('en',{style:'currency',currency}).format(Number(minor)/10**options.maximumFractionDigits);}catch{return esc(currency)+' '+esc(minor)+' minor units';}
}
function dateLabel(value,dateOnly=false){
  const raw=String(value??'');if(!raw)return '';
  const isDate=/^\d{4}-\d\d-\d\d$/.test(raw);
  if(!isDate&&!/^\d{4}-\d\d-\d\dT/.test(raw))return raw;
  const date=new Date(isDate?raw+'T12:00:00Z':raw);
  if(!Number.isFinite(date.getTime()))return raw;
  const day=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date);
  if(isDate||dateOnly)return day;
  const iso=date.toISOString();
  const time=iso.slice(17,19)==='00'?iso.slice(11,16):iso.slice(11,19);
  return day+', '+time+' UTC';
}
const serviceLabel=value=>String(value??'').replace(/_/g,' ');
function contactKind(lead){
  const route=href(lead.contact_route,true).toLowerCase();
  return route.startsWith('mailto:')?'email':route.startsWith('tel:')?'phone':route?'web':'other';
}
function contactSummary(leads){
  const counts={email:0,phone:0,web:0,other:0};
  for(const lead of leads)counts[contactKind(lead)]++;
  return Object.entries(counts).filter(([,count])=>count).map(([kind,count])=>
    count+' '+({email:'email route',phone:'phone route',web:'web route',other:'other contact route'}[kind])+(count===1?'':'s')).join(' · ');
}
function packIndex(leads){
  if(leads.length<2)return '';
  return '<section class="contents" aria-labelledby="contents-title"><h2 id="contents-title">Included prospects</h2>'+
    '<div class="table-wrap"><table><thead><tr><th scope="col">Company or buyer</th><th scope="col">Published contact route</th></tr></thead><tbody>'+
    leads.map((lead,index)=>'<tr><th scope="row"><a href="#lead-'+(index+1)+'">'+esc(index+1)+'. '+esc(lead.organization)+'</a></th>'+
      '<td>'+link(lead.contact_route,true)+'</td></tr>').join('')+'</tbody></table></div></section>';
}
export function renderLeadPackHTML(customerEdition){
  const d=customerEdition,leads=Array.isArray(d.leads)?d.leads:[];
  const css="#lead-customer-report,#lead-customer-report *{box-sizing:border-box}#lead-customer-report{color-scheme:light;max-width:1000px;width:100%;margin:0 auto;padding:42px 28px;font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#202020;background:#fff}#lead-customer-report :is(h1,h2,h3,p,dl,dt,dd,th,td,li,strong,em,span,div,section){color:#202020}#lead-customer-report h1{font-size:30px;line-height:1.2}#lead-customer-report h2{font-size:21px;margin:0 0 18px}#lead-customer-report h3{font-size:16px}#lead-customer-report header{color:#202020;background:#fff;border-bottom:2px solid #333;padding-bottom:24px;margin-bottom:28px}#lead-customer-report .eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.08em;color:#555}#lead-customer-report .summary{color:#202020;padding:18px;background:#f4f4f4;border:1px solid #ccc}#lead-customer-report article{color:#202020;background:#fff;padding:28px 0;border-top:1px solid #bbb;break-inside:avoid}#lead-customer-report dl{display:grid;grid-template-columns:minmax(150px,1fr) 3fr;gap:8px 20px}#lead-customer-report dt{font-weight:600}#lead-customer-report dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report p{white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report table{width:100%;border-collapse:collapse;color:#202020;background:#fff}#lead-customer-report th,#lead-customer-report td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}#lead-customer-report thead th{font-size:13px;color:#202020;background:#f4f4f4}#lead-customer-report .table-wrap{overflow-x:auto}#lead-customer-report .contents{margin:28px 0}#lead-customer-report a{color:#222;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}#lead-customer-report a:focus-visible{outline:2px solid #333;outline-offset:3px}#lead-customer-report .opening{color:#202020;background:#fff;padding:18px;border:1px solid #bbb;white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report footer{margin-top:30px;font-size:13px;color:#555;background:#fff}@media(max-width:600px){#lead-customer-report{padding:24px 16px}#lead-customer-report dl{display:block}#lead-customer-report dt{margin-top:12px}}@media print{#lead-customer-report{max-width:none;padding:0;font-size:11pt}#lead-customer-report .summary{background:#fff}#lead-customer-report h1{font-size:22pt}#lead-customer-report a{text-decoration:none}#lead-customer-report article{break-inside:auto}#lead-customer-report h2,#lead-customer-report h3{break-after:avoid}#lead-customer-report .opening{break-inside:avoid}}";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(d.title)+' · '+esc(d.customer)+'</title><style>'+css+'</style></head><body><main id="lead-customer-report"><header>'+
    '<p class="eyebrow">'+esc(KIND[d.delivery_type]||d.delivery_type)+'</p><h1>'+esc(d.title)+'</h1><p>Prepared for '+esc(d.customer)+'</p>'+
    '<dl>'+pair('Prepared',dateLabel(d.prepared_at,true))+pair('Leads',String(leads.length))+pair('Contact routes',contactSummary(leads))+pair(d.delivery_type==='paid'?'Pack price':'Edition price',money(d.price_minor,d.currency))+'</dl></header>'+
    (d.original_kind==='complimentary'||d.delivery_type==='complimentary'?'<p class="summary">This full pack is complimentary. There is no charge for these '+esc(leads.length)+' researched leads.</p>':'')+
    ((d.included_editions||[]).length?'<p>This pack combines the earlier selections with refreshed research.</p>':'')+
    '<section class="summary"><h2>Selection criteria</h2><p>'+esc(d.criteria)+'</p><dl>'+pair('Geography',d.geography)+pair('Skills / services',(d.skills||[]).map(serviceLabel).join(', '))+'</dl></section>'+
    packIndex(leads)+
    leads.map((lead,index)=>'<article id="lead-'+(index+1)+'"><h2>'+esc(index+1)+'. '+esc(lead.organization)+'</h2><dl>'+
      (lead.company_url?'<dt>Company website</dt><dd>'+link(lead.company_url)+'</dd>':'')+pair('Contact',lead.person)+
      pair('Source signal',SIGNAL[lead.signal_type]||lead.signal_type)+pair('Source status',sourceStatus(lead))+
      pair('Source context',lead.status_note)+pair('Geography',lead.geography)+pair(lead.signal_type==='company_fit'?'Published financial context':'Published budget',lead.published_budget)+'</dl>'+
      '<h3>'+esc(lead.signal_type==='company_fit'?'Published workflow':lead.signal_type==='paid_request'?'Published request':'Published problem')+'</h3><p>'+esc(lead.business_need)+'</p><h3>Why it fits</h3><p>'+esc(lead.why_it_fits)+'</p>'+
      '<h3>Source and timing</h3><dl><dt>Original source</dt><dd>'+link(lead.source_url)+'</dd>'+
      pair(lead.signal_type==='company_fit'?'Source publication date':'Original request date',dateLabel(lead.original_request_date))+pair(lead.signal_type==='company_fit'?'Last source update':'Last buyer update',dateLabel(lead.last_buyer_update))+
      pair('Source checked',dateLabel(lead.source_checked_at))+pair('Published deadline',dateLabel(lead.deadline))+sourceTimePairs(lead.source_time_observation)+'</dl>'+
      '<h3>Contact route</h3><p>'+link(lead.contact_route,true)+'</p>'+(lead.contact_instructions?'<p>'+esc(lead.contact_instructions)+'</p>':'')+
      (lead.opening_message?'<h3>Suggested opening message</h3><div class="opening">'+esc(lead.opening_message)+'</div>':'')+'</article>').join('')+
    '<footer>Prepared '+esc(dateLabel(d.prepared_at,true))+' · '+esc(KIND[d.delivery_type]||d.delivery_type)+' · '+esc(d.customer)+'</footer></main></body></html>';
}
const CSV_FIELDS=[
  ['organization','Company or buyer'],['company_url','Company website'],['person','Contact name'],
  ['signal_type','Source signal'],['source_status','Current source status'],['status_note','Status context'],
  ['business_need','Published need or workflow'],['why_it_fits','Why it fits'],['source_url','Original source URL'],
  ['original_request_date','Original request date'],['last_buyer_update','Last buyer update'],
  ['source_checked_at','Source checked'],['deadline','Published deadline'],['contact_route','Published contact route'],
  ['contact_instructions','Contact instructions'],['geography','Lead geography'],['published_budget','Published budget'],
  ['opening_message','Suggested opening message']
];
const SOURCE_TIME_CSV_FIELDS=[
  ['observed_publication_label','Original relative publication label'],
  ['observed_closing_label','Original relative closing label'],
  ['observed_checked_at','Labels observed'],['observed_source_url','Observed source URL']
];
function customerCell(lead,key){
  if(key.startsWith('observed_')){
    const value=lead.source_time_observation?.[key.slice('observed_'.length)]??'';
    return key==='observed_checked_at'?dateLabel(value):value;
  }
  if(key==='signal_type')return SIGNAL[lead[key]]||lead[key];
  if(key==='source_status')return sourceStatus(lead);
  if(['original_request_date','last_buyer_update','source_checked_at','deadline'].includes(key))return dateLabel(lead[key]);
  return lead[key];
}
function csvCell(value){
  let s=String(value??'');
  if(typeof value!=='number'&&/^[\s]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function leadPackCSV(customerEdition){
  const d=customerEdition,metadata=['Customer','Pack title','Delivery type','Prepared on','Criteria','Requested geography','Skills or services','Pack quantity','Currency','Pack price'];
  const fields=(d.leads||[]).some(lead=>lead.source_time_observation)?[...CSV_FIELDS,...SOURCE_TIME_CSV_FIELDS]:CSV_FIELDS;
  const lineage=d.original_kind==='complimentary'||d.delivery_type==='complimentary';
  const provenance=(d.included_editions||[]).map(ref=>ref.id+' @ '+ref.sha256).join('; ');
  const optionalHeaders=[...(lineage?['Original edition type','Commercially eligible']:[]),...(provenance?['Included earlier editions']:[])];
  const optionalValues=[...(lineage?['Complimentary full pack','No']:[]),...(provenance?[provenance]:[])];
  const head=[...metadata,...optionalHeaders,...fields.map(([,label])=>label)].map(csvCell).join(',');
  const rows=(d.leads||[]).map(lead=>[d.customer,d.title,KIND[d.delivery_type]||d.delivery_type,dateLabel(d.prepared_at,true),d.criteria,d.geography,(d.skills||[]).map(serviceLabel).join('; '),d.quantity,d.currency,money(d.price_minor,d.currency),
    ...optionalValues,...fields.map(([key])=>customerCell(lead,key))].map(csvCell).join(','));
  return '\ufeff'+[head,...rows].join('\r\n')+'\r\n';
}
