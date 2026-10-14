/** Procurement response preparation in the existing Lead fulfillment workspace. */
const line=(name,label,type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
const area=(name,label,rows=3,extra='')=>'<label>'+label+'<textarea name="'+name+'" rows="'+rows+'" '+extra+'></textarea></label>';
const choice=(name,label,values)=>'<label>'+label+'<select name="'+name+'">'+values.map(([id,text])=>'<option value="'+id+'">'+text+'</option>').join('')+'</select></label>';
export function renderLeadProcurementPanel(){
  const sections=[
    ['files','Issuer packet and amendments','Choose complete files already saved in this customer’s Files panel. Their selected versions remain part of this response record.','Add a source file'],
    ['timeline','Dates and questions schedule','Keep the date, time and zone as printed by the issuer. Enter a UTC instant only when it is known from the source.','Add a date'],
    ['requirements','Eligibility and required returnables','Record the issuer’s complete requirement, original page and wording, then the response owner, progress and supporting files.','Add a requirement'],
    ['questions','Questions and published answers','Keep the original question, its actual correspondence reference and any complete issuer answer.','Add a question'],
    ['assignments','Response work and owners','Assign the actual preparation work, due date, dependencies and completion note.','Add an assignment'],
    ['vendor_fit','Vendor fit and open issues','Explain fit against this opportunity and retain the evidence or unresolved question.','Add a fit assessment']
  ];
  return '<section id="procurement-panel" hidden aria-labelledby="procurement-title">'+
    '<div class="section-heading"><div><p class="eyebrow">Bid preparation</p><h2 id="procurement-title">Procurement responses</h2></div><button id="procurement-new" type="button">Prepare a response</button></div>'+
    '<p>Open an original buyer opportunity, retain its issuer documents, and organize the complete response in this customer’s saved workspace.</p>'+
    '<div class="actions"><button type="button" id="procurement-download-draft">Download complete response and handover drafts</button><label>Restore complete drafts<input id="procurement-restore-draft" type="file" accept="application/json,.json"></label></div>'+
    '<p id="procurement-summary" role="status"></p><div id="procurement-records"></div>'+
    '<details id="procurement-editor" hidden><summary>Response preparation and source documents</summary>'+
    '<form id="procurement-form"><div class="form-grid">'+
    '<label>Original buyer opportunity<select name="lead_id" required></select></label>'+
    line('title','Response title','text','required maxlength="300"')+
    line('issuer','Issuing organization','text','required maxlength="500"')+
    line('reference','Issuer reference','text','maxlength="300"')+
    choice('procurement_type','Procurement type',[['RFP','Request for proposals'],['RFQ','Request for quotation or qualifications'],['RFI','Request for information'],['grant','Grant'],['other','Other published opportunity']])+
    line('source_url','Original issuer page','url')+line('owner','Response owner','text','maxlength="500"')+
    line('actor','Saving operator','text','required maxlength="500"')+'</div>'+
    '<p id="procurement-source-anchor"></p>'+
    sections.map(([id,title,description,button])=>'<details class="panel" data-procurement-section="'+id+'"><summary>'+title+'</summary><p>'+description+'</p><div id="procurement-'+id+'"></div><button type="button" data-procurement-add="'+id+'">'+button+'</button></details>').join('')+
    '<details class="panel"><summary>Response decision</summary><div class="form-grid">'+
    choice('decision_status','Decision',[['unreviewed','Under review'],['pursue','Prepare a response'],['decline','Decline this opportunity'],['needs_information','Resolve open questions']])+
    line('decision_reviewed_by','Reviewing operator')+line('decision_reviewed_at','Review time, with timezone','text','placeholder="2026-10-13T12:00:00Z"')+'</div>'+
    area('decision_reason','Decision and fit reasoning',4)+'</details>'+
    '<details class="panel"><summary>Submission instructions</summary><p>Retain the issuer’s submission method, destination and confirmation requirements.</p><div class="form-grid">'+
    line('submission_method','Submission method')+line('submission_destination','Issuer portal, address or destination')+'</div>'+
    area('submission_instructions','Complete submission instructions',5)+
    '<label><input type="checkbox" name="submission_confirmation_required"> The issuer requires a confirmation or receipt</label></details>'+
    area('notes','Working notes',5,'maxlength="32000"')+
    '<div class="actions"><button type="button" id="procurement-preview">Review complete response</button><button type="submit">Save response edition</button><button type="button" id="procurement-discard">Discard this draft</button></div>'+
    '<div id="procurement-preview-result" role="status"></div></form></details>'+
    '<details id="procurement-handover" hidden><summary>Prepare a complete bid handover</summary><form id="procurement-handover-form">'+
    '<label>Saved response edition<select name="procurement_id" required></select></label>'+
    '<p id="procurement-handover-anchor" role="status"></p><div id="procurement-handover-review-links" class="actions"></div>'+
    '<button id="procurement-handover-review" type="button">Use current response edition after review</button>'+
    '<div class="form-grid">'+line('title','Handover title','text','required maxlength="300"')+
    line('actor','Preparing operator','text','required maxlength="500"')+
    '<label>Earlier handover replaced by this edition<select name="supersedes"></select></label></div>'+
    area('instructions','Complete handover instructions',5)+area('reason','Reason for replacing the earlier handover',3)+
    '<div class="actions"><button type="submit">Prepare complete handover</button><button type="button" id="procurement-handover-discard">Discard this handover draft</button></div></form></details>'+
    '<div id="procurement-handovers"></div>'+
    '<p>Use Download team working record above to transfer the complete editable response history with this customer’s original leads and files. Receive it through the existing working-record import.</p></section>';
}
