/** Creator programme operator forms in the original customer workspace. */
export function renderCreatorProgrammePanel(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const input=(name,label,type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
  const area=(name,label,rows=3,extra='')=>'<label>'+label+'<textarea name="'+name+'" rows="'+rows+'" '+extra+'></textarea></label>';
  const sel=(name,label,opts,extra='')=>'<label>'+label+'<select name="'+name+'" '+extra+'>'+opts.map(x=>'<option value="'+esc(Array.isArray(x)?x[0]:x)+'">'+esc(Array.isArray(x)?x[1]:x)+'</option>').join('')+'</select></label>';
  const minor=(name,label)=>input(name,label+' · minor currency units','text','inputmode="numeric" pattern="(0|[1-9][0-9]{0,23})" required');
  const num=(name,label,min=0,max=10000000)=>input(name,label,'number','min="'+min+'" max="'+max+'" step="1" required');
  const mapFields=['event_id','type','occurred_at','user_id','user_kind','session_id','creator_code','link_id','related_event_id','amount_minor','platform_revenue_minor','currency'];
  return `<section id="creator-programme-panel" hidden aria-labelledby="cp-heading">
<link rel="stylesheet" href="/lead_acquisition_intake.css"><style>
#creator-programme-panel{--cp-line:#b8bcc1;--cp-muted:#555b61;--cp-paper:#f6f7f8;color:#16191c;background:#fff}
#creator-programme-panel h3{margin-top:1.5rem}
#creator-programme-panel .cp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem}
#creator-programme-panel .cp-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end;margin:.8rem 0}
#creator-programme-panel .cp-scroll{overflow:auto;max-height:32rem;border:1px solid var(--cp-line);margin:1rem 0}
#creator-programme-panel table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
#creator-programme-panel th,#creator-programme-panel td{padding:.65rem;text-align:left;border-bottom:1px solid #d6d9dc;vertical-align:top}
#creator-programme-panel th{background:var(--cp-paper)}
#creator-programme-panel label{display:flex;flex-direction:column;gap:.35rem;margin:.4rem 0}
#creator-programme-panel input,#creator-programme-panel select,#creator-programme-panel textarea{color:#16191c;background:#fff;border:1px solid #8c9298;border-radius:2px;padding:.55rem;max-width:100%;min-width:0;box-sizing:border-box}
#creator-programme-panel textarea{width:100%}
#creator-programme-panel button,#creator-programme-panel .cp-download{color:#16191c;background:#f3f4f5;border:1px solid #8c9298;border-radius:2px;padding:.55rem .8rem;cursor:pointer}
#creator-programme-panel button:disabled{opacity:.5;cursor:default}
#creator-programme-panel button:focus-visible,#creator-programme-panel a:focus-visible,#creator-programme-panel input:focus-visible,#creator-programme-panel select:focus-visible,#creator-programme-panel textarea:focus-visible{outline:3px solid #333;outline-offset:2px}
#creator-programme-panel fieldset{border:1px solid var(--cp-line);padding:1rem;margin:1rem 0;min-width:0}
#creator-programme-panel details{border-top:1px solid var(--cp-line);padding:.8rem 0}
#creator-programme-panel summary{font-weight:600;cursor:pointer}
#creator-programme-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto;background:var(--cp-paper);padding:1rem}
#creator-programme-panel .cp-comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:1rem}
#creator-programme-panel .cp-comparison>section{min-width:0;border:1px solid var(--cp-line);padding:1rem}
#creator-programme-panel .cp-note{color:var(--cp-muted);font-size:.93rem}
#creator-programme-panel .cp-total{font-size:1.4rem;font-weight:600;margin:.2rem 0}
#creator-programme-panel [hidden]{display:none!important}
</style>
<p class="eyebrow">Creator partnerships / Original customer workspace</p><h2 id="cp-heading">Creator programmes</h2>
<p>Manage creator agreements, onboarding, measured usage and earned compensation alongside this customer’s original lead pack and delivery history.</p>
<div class="cp-actions"><label>Saved programme<select id="cp-programme-select" aria-label="Saved creator programme"></select></label><button type="button" id="cp-new-programme">New programme</button><a id="cp-working-record" class="cp-download">Download complete customer working record</a></div>
<p id="cp-status" role="status" aria-live="polite"></p><p id="cp-identity" class="cp-note"></p>
<details id="cp-settings-details" open><summary>Programme settings and proposed targets</summary>
<form id="cp-settings-form">
<div class="cp-grid">${input('title','Programme title','text','required maxlength="300"')}${sel('evidence_mode','Observation mode',[['','Choose mode'],['live','Live customer programme'],['reference','Reference exercise']],'required')}${input('currency','Currency','text','pattern="[A-Z]{3}" maxlength="3" required')}${input('starts_on','Start date · UTC','date','required')}${input('ends_on','End date · UTC','date','required')}${input('owner','Responsible operator','text','maxlength="8000"')}${input('commercial_status','Commercial status','text','maxlength="8000"')}</div>
<div class="cp-grid">${sel('attribution_model','Attribution model',[['first_touch','First observed touch'],['last_touch','Last observed touch']])}${num('attribution_days','Attribution window · days',1,365)}${num('return_min_days','Return interval after signup · days',1,90)}${sel('activation_types','Activation requires any selected event',[['publish','Publish'],['return_usage','Return usage'],['publish,return_usage','Publish or return usage']])}</div>
${area('success_definition','Success definition',3,'maxlength="8000"')}${area('measurement_contract','Measurement contract and source agreement',3,'maxlength="8000"')}
<p class="cp-note">Targets and budgets are planning values. An agreement or guarantee must be recorded in its actual commercial terms. All amounts below use exact minor currency units; for USD, 100 means $1.00.</p>
<div class="cp-grid">${minor('service_fee_minor','Planned service fee')}${minor('creator_budget_minor','Planned creator budget')}${minor('other_budget_minor','Other planned budget')}${num('qualified_creators','Target qualified creators')}${num('signed_partners','Target signed partnerships')}${num('activated_users','Target activated users')}${num('paying_users','Target paying users')}</div>
${area('notes','Programme notes',3,'maxlength="8000"')}
<div class="cp-actions"><button type="submit" id="cp-settings-save">Save programme</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form></details>
<div id="cp-saved-work" hidden>
<details open><summary>Creators, agreements and onboarding</summary>
<div class="cp-actions"><button id="cp-new-creator" type="button">Add creator from original leads</button></div><div id="cp-creators" class="cp-scroll"></div>
<form id="cp-creator-form" hidden><h3 id="cp-creator-heading">Creator</h3><div class="cp-grid">${sel('lead_id','Original lead',[],'required')}${input('name','Creator name','text','required maxlength="300"')}${sel('stage','Relationship stage',['research','qualified','contacted','discussing','agreed','onboarding','active','declined','paused','closed'])}${input('owner','Responsible operator','text','maxlength="300"')}${input('platform_user_id','Actual platform account ID','text','maxlength="160"')}${input('contact_route','Original contact route','text','maxlength="2000"')}</div>
${area('stage_evidence','Source for the current relationship stage',3,'maxlength="8000"')}
<h4>Issued tracking links</h4><p class="cp-note">Use an existing reviewed destination and source. Saving a tracking link records it here; it does not create a redirect or provision analytics.</p><div id="cp-tracking-rows"></div><button type="button" data-cp-add="tracking">Add tracking link</button>
<h4>Onboarding and campaign work</h4><div id="cp-task-rows"></div><button type="button" data-cp-add="tasks">Add task</button>
<h4>Compensation terms</h4><p class="cp-note">Keep proposed and agreed terms distinct. Previously agreed terms retain their original price, cap and agreement. A new agreement uses a new term.</p><div id="cp-term-rows"></div><button type="button" data-cp-add="terms">Add compensation term</button>
<div class="cp-actions"><button type="submit">Save complete creator record</button><button type="button" data-cp-cancel>Close unsaved changes</button></div><details><summary>Retained creator history</summary><pre id="cp-creator-history"></pre></details></form></details>
<details><summary>Original event sources and field mapping</summary>
<p>Import a complete CSV or JSON array from the actual collection source. Record its origin, observation time and column mapping. Included and excluded source revisions remain in the customer record.</p>
<div class="cp-actions"><button type="button" id="cp-new-source">Add event source</button></div><div id="cp-sources" class="cp-scroll"></div>
<form id="cp-source-form" hidden><h3 id="cp-source-heading">Event source</h3><label>Complete UTF-8 source file<input type="file" name="source_file" accept=".csv,.json,text/csv,application/json"></label>
<div class="cp-grid">${input('filename','Original filename','text','required maxlength="500"')}${sel('format','File format',['csv','json'])}${input('delimiter','CSV delimiter','text','maxlength="1"')}${sel('subject_kind','Source cohort',[['mixed','Mixed · each event supplies its cohort'],['creator','Creator accounts'],['fan','Fans / audience accounts']])}${input('observed_at','Observation time · ISO 8601 with timezone','text','required placeholder="2026-10-13T12:00:00Z"')}${sel('state','Inclusion',[['included','Include current edition'],['excluded','Exclude current edition']])}</div>
${area('origin','Original export or collection source',2,'required maxlength="4000"')}${area('reason','Inclusion or exclusion reason',2,'maxlength="4000"')}
<fieldset><legend>Map original column names</legend><p class="cp-note">Map event_id, type and occurred_at. Non-click events also need user_id. Mixed cohorts need user_kind. Payment and refund events use exact minor-unit amounts and currency; a refund links its original payment through related_event_id. Leave absent optional fields unmapped.</p><div class="cp-grid">${mapFields.map(f=>input('map_'+f,f.replaceAll('_',' ')+' column','text')).join('')}</div></fieldset>
<label>Complete source text<textarea name="content" rows="12" spellcheck="false"></textarea></label><p id="cp-source-content-status" class="cp-note"></p>
<div class="cp-actions"><button type="button" id="cp-source-preview">Preview and reconcile all rows</button><button type="submit" id="cp-source-save">Save complete source edition</button><button type="button" id="cp-source-download">Download original source text</button><button type="button" data-cp-cancel>Close unsaved changes</button></div>
<div id="cp-source-review" aria-live="polite"></div>
<div id="cp-source-review-controls" class="cp-actions" hidden><button type="button" id="cp-source-review-prev">Previous rows</button><button type="button" id="cp-source-review-next">Next rows</button><button type="button" id="cp-source-review-json">Download complete review JSON</button><button type="button" id="cp-source-review-csv">Download complete review CSV</button></div>
<details><summary>Retained source revision metadata</summary><pre id="cp-source-history"></pre></details></form></details>
<details open><summary>Observed outcomes and attribution</summary>
<p id="cp-report-mode"></p><div id="cp-cohorts" class="cp-scroll"></div><div id="cp-economics" class="cp-grid"></div><div id="cp-findings"></div>
<div class="cp-actions"><label>Find observed user<input id="cp-user-search" type="search" placeholder="User or creator ID"></label><button type="button" id="cp-users-prev">Previous users</button><button type="button" id="cp-users-next">Next users</button><span id="cp-users-position"></span><button type="button" id="cp-report-download">Download complete report</button></div><div id="cp-users" class="cp-scroll"></div>
<form id="cp-attribution-form" hidden><h3>Review observed attribution</h3><p id="cp-attribution-user"></p>${sel('creator_id','Attribute to creator',[])}${area('reason','Decision',3,'required maxlength="8000"')}${area('evidence','Actual source supporting this decision',3,'required maxlength="8000"')}<div class="cp-actions"><button type="submit">Record attribution review</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<details><summary>Full event lineage and attribution decisions</summary><p class="cp-note">The downloaded report includes every parsed event, original source reference and finding.</p><pre id="cp-attribution-history"></pre></details></details>
<details open><summary>Creator earnings, completed payments and costs</summary><p class="cp-note">Earned amounts follow the retained agreed terms and selected source report. Recording a completed payment retains its actual reference; it does not send money.</p>
<div id="cp-earnings" class="cp-scroll"></div>
<form id="cp-accrual-form" hidden><h3>Record earned compensation</h3><p id="cp-accrual-summary"></p><pre id="cp-accrual-statement"></pre>${area('evidence','Review and earning source',3,'required maxlength="8000"')}<div class="cp-actions"><button type="submit">Record current earned amount</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<form id="cp-payment-form" hidden><h3>Record completed creator payment</h3><p id="cp-payment-summary"></p><div class="cp-grid">${minor('amount_minor','Completed payment')}${input('provider_id','Actual payment provider reference','text','required maxlength="1000"')}${input('paid_at','Actual payment time · ISO 8601 with timezone','text','required')}</div>${area('evidence','Completed payment source',3,'required maxlength="8000"')}<div class="cp-actions"><button type="submit">Record completed payment</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<h3>Completed creator payments and cash returns</h3>
<p class="cp-note">Gross paid retains every original payment. Record money actually returned against its original payment; net paid subtracts those completed returns. Unpaid earning follows the net amount. A dispute or case note on its own changes no cash or earned amount.</p>
<div id="cp-payment-cash" class="cp-scroll"></div>
<form id="cp-payment-return-form" hidden><h3>Record money returned from an original payment</h3><p id="cp-payment-return-summary"></p><div class="cp-grid">${minor('amount_minor','Actual amount returned')}${input('provider_id','Actual return provider reference','text','required maxlength="1000"')}${input('returned_at','Actual return time · ISO 8601 with timezone','text','required')}</div>${area('reason','Reason for this completed return',3,'required maxlength="8000"')}${area('evidence','Actual completed return source',3,'required maxlength="8000"')}<div class="cp-actions"><button type="submit">Record completed cash return</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<details open><summary>Retained cash returns</summary><div id="cp-payment-returns" class="cp-scroll"></div></details>
<h3>Settlement and payment cases</h3>
<p class="cp-note">Keep the actual reason, evidence, responsible operator and resolution with the same creator. A case may refer to one original payment or to the creator generally. Later editions retain that relationship and every prior case document. The complete customer working record also retains each original save operation.</p>
<div class="cp-actions"><button type="button" id="cp-new-settlement-case">Open a settlement case</button><button type="button" id="cp-cash-records-download">Download complete cash and case records</button></div>
<div id="cp-settlement-cases" class="cp-scroll"></div>
<form id="cp-settlement-case-form" hidden><h3 id="cp-settlement-case-heading">Settlement case</h3><div class="cp-grid">${sel('creator_id','Original creator',[],'required')}${sel('payment_id','Original completed payment',[])}${input('title','Case title','text','required maxlength="300"')}${sel('state','Case state',[['open','Open'],['in_review','In review'],['resolved','Resolved'],['closed','Closed']])}${input('owner','Responsible operator','text','maxlength="300"')}</div>
<p id="cp-settlement-case-identity" class="cp-note"></p>
${area('reason','Reason for this case',3,'required maxlength="8000"')}${area('evidence','Actual case evidence',3,'required maxlength="8000"')}
<fieldset><legend>Related completed cash returns</legend><div id="cp-settlement-case-returns"></div></fieldset>
${area('resolution','Resolution · required for resolved or closed cases',3,'maxlength="8000"')}
<div class="cp-actions"><button type="submit">Save complete case edition</button><button type="button" id="cp-settlement-case-download">Download complete saved case history</button><button type="button" data-cp-cancel>Close unsaved changes</button></div>
<details><summary>Every saved case edition</summary><pre id="cp-settlement-case-history"></pre></details>
</form>
<div class="cp-actions"><button type="button" id="cp-new-cost">Record actual programme cost</button></div><form id="cp-cost-form" hidden><h3>Record actual cost</h3><div class="cp-grid">${sel('category','Cost category',['service','advertising','other'])}${minor('amount_minor','Actual cost')}${input('occurred_at','Actual cost time · ISO 8601 with timezone','text','required')}</div>${area('evidence','Invoice, receipt or other actual cost source',3,'required maxlength="4000"')}<div class="cp-actions"><button type="submit">Record actual cost</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<div class="cp-actions"><button type="button" id="cp-new-term-end">Record an agreement end</button></div>
<form id="cp-term-end-form" hidden><h3>Record an agreement end</h3><p class="cp-note">Select the original agreed term and its actual effective end. The original agreement, already recorded earning and completed payments remain in the customer history.</p>${sel('term_selection','Original agreed creator term',[],'required')}${input('effective_at','Effective end · ISO 8601 with timezone','text','required')}${area('reason','Reason for ending this agreement',3,'required maxlength="8000"')}${area('evidence','Actual agreement or termination source',3,'required maxlength="8000"')}<div class="cp-actions"><button type="submit">Record agreement end</button><button type="button" data-cp-cancel>Close unsaved changes</button></div></form>
<details><summary>Agreement endings</summary><div id="cp-term-changes" class="cp-scroll"></div></details>
<details><summary>Retained earnings, payment and cost records</summary><div id="cp-financial-history" class="cp-scroll"></div></details></details>
<details><summary>Programme history and handover</summary><p>The complete customer working record includes original leads, editions, delivery history, programmes, source contents, creator histories and original saved operations. Receive it through the existing team working-record workflow above to continue the same customer.</p><p><a id="cp-working-record-bottom">Download complete customer working record</a></p><pre id="cp-programme-history"></pre><h3>Received report history</h3><p class="cp-note">Each reviewed handover retains its original report, the calculation accepted when it was received, and the operator’s reason. Later calculations appear in Observed outcomes above.</p><div id="cp-report-history"></div></details>
</div>
<details id="cp-handover-details"><summary>Receive a complete creator programme</summary>
<p>Choose the original programme handover for this customer. Review its retained report alongside the calculation from this application before receiving its original programme and saved operations.</p>
<form id="cp-handover-form">
<label>Complete UTF-8 handover file · up to 8 MiB<input type="file" name="handover_file" accept=".json,application/json"></label>
<label>Complete handover JSON<textarea name="bundle_json" rows="10" spellcheck="false"></textarea></label>
<p id="cp-handover-status" role="status" aria-live="polite">Choose the complete original handover to review.</p>
<div class="cp-actions"><button type="button" id="cp-handover-review">Review both reports</button><button type="button" id="cp-handover-download">Download original handover</button><button type="button" id="cp-handover-clear">Clear handover draft</button></div>
<div id="cp-handover-comparison" hidden></div>
<label id="cp-handover-reason-label">Reason for receiving the retained report with the current calculation<textarea name="reason" rows="3" maxlength="8000"></textarea></label>
<p id="cp-handover-save-note" class="cp-note">Review the complete handover before saving.</p>
<div class="cp-actions"><button type="submit" id="cp-handover-save" disabled>Receive original programme</button></div>
</form></details>
</section>`;
}
