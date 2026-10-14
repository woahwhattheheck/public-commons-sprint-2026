/** Complete customer handovers from one immutable lead edition. */
import core from './lead_fulfillment_core.cjs';
import hashes from '../../host/connected_sha256.cjs';
import archiveCore from './lead_customer_archive_core.cjs';
import {renderLeadPackHTML,leadPackCSV} from './lead_fulfillment_view.mjs';

const {sha256Utf8,sha256Bytes}=hashes;
const KIND={sample:'Free sample',paid:'Paid lead pack',replacement:'Replacement pack'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value,null,2)+'\n';
const issue=message=>Object.assign(new Error(message),{status:422,code:'LEAD_CUSTOMER_BUNDLE'});
function dateLabel(value){
  const at=new Date(value);
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(at);
}
function money(minor,currency){
  const format=new Intl.NumberFormat('en',{style:'currency',currency});
  return format.format(minor/10**format.resolvedOptions().maximumFractionDigits);
}
function filename(customer,kind,preparedAt,identity){
  const customerName=customer.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'Customer';
  return customerName+'-'+kind+'-lead-pack-'+preparedAt.slice(0,10)+'-'+identity.slice(0,10)+'.zip';
}

/** Public names and dates only; internal replacement reasons stay in the team record. */
export function leadPackHandover(ledger,options={}){
  return core.leadFulfillmentExport(ledger,{...options,format:'customer-handover'}).value;
}
function changeHTML(handover){
  if(!handover.changes.length)return '';
  return '<section class="summary"><h2>Changes in this replacement</h2><p>This complete pack updates the edition prepared on '+
    esc(dateLabel(handover.previous_prepared_at))+'. '+esc(handover.retained_leads)+' previously supplied leads are retained.</p><ul>'+
    handover.changes.map(row=>'<li>'+esc(row.previous_company)+' → '+esc(row.replacement_company)+'</li>').join('')+
    '</ul><p>Use the complete lead list below for this edition.</p></section>';
}
export function renderLeadHandoverHTML(edition,handover){
  const document=renderLeadPackHTML(edition),addition=changeHTML(handover);
  return addition?document.replace('</header>',()=>'</header>'+addition):document;
}
function startText(edition,handover){
  const lines=[edition.title,'Prepared for '+edition.customer,'',
    KIND[edition.delivery_type]+' · '+dateLabel(edition.prepared_at),
    edition.quantity+' '+(edition.quantity===1?'lead':'leads')+' · '+money(edition.price_minor,edition.currency),'',
    'OPEN YOUR PACK','',
    '1. Extract the complete ZIP into one folder.',
    '2. Open lead-pack.html for the customer brief, sources, contact instructions and suggested openings.',
    '3. Open leads.csv in your spreadsheet to work through the same complete selection.',
    '4. Use leads.json when importing the prepared customer fields into another application.','',
    'YOUR SELECTION','',edition.criteria,''];
  if(handover.changes.length)lines.push('THIS REPLACEMENT','',
    'This complete pack updates the edition prepared on '+dateLabel(handover.previous_prepared_at)+'.',
    ...handover.changes.map(row=>row.previous_company+' → '+row.replacement_company),
    handover.retained_leads+' previously supplied leads are retained. Use this complete list for the replacement edition.','');
  lines.push('WORKING THE LEADS','',
    'Read the published workflow or request, its source date and status, then adapt the supplied opening to your offer.',
    'Use the published contact route and any application instructions in each record.',
    'Keep your outreach and follow-up notes in your own spreadsheet or sales application.',
    'For a correction, identify the company and original source when replying to the person who supplied this pack. The selection criteria above retain the agreed scope.','',
    'FILES','',
    'lead-pack.html — readable customer brief and every selected lead',
    'leads.csv — spreadsheet rows for the complete selection',
    'leads.json — complete customer fields with original machine values',
    'manifest.json — file names, byte counts and content identities','');
  return lines.join('\n');
}
const {file,zip,leadCustomerFileArchive}=archiveCore.createLeadCustomerArchive(hashes);
export {leadCustomerFileArchive};
/** Original complete customer documents, shared by explicit supporting packages. */
export function leadPackCustomerDocuments(ledger,options={}){
  return leadPackCustomerDocumentsFromHandover(leadPackHandover(ledger,options));
}
/** The same original documents from an already selected immutable lead edition. */
export function leadPackCustomerDocumentsFromHandover({edition,handover,edition_sha256}){
  return {edition,handover,edition_sha256,files:[
    file('START_HERE.txt',startText(edition,handover)),
    file('lead-pack.html',renderLeadHandoverHTML(edition,handover)),
    file('leads.csv',leadPackCSV(edition)),
    file('leads.json',json(edition))
  ]};
}
export function leadPackBundle(ledger,options={}){
  return leadPackBundleFromHandover(leadPackHandover(ledger,options));
}
/** Standard customer ZIP from the same complete selected handover. */
export function leadPackBundleFromHandover(prepared){
  const {edition,handover,edition_sha256,files}=leadPackCustomerDocumentsFromHandover(prepared);
  const customerIdentity=files.find(row=>row.name==='leads.json').sha256;
  const manifest={version:'dealscout.lead-customer-bundle.v1',customer:edition.customer,title:edition.title,
    delivery_type:edition.delivery_type,prepared_at:edition.prepared_at,lead_count:edition.quantity,
    currency:edition.currency,price_minor:edition.price_minor,customer_edition_sha256:customerIdentity,
    handover,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
  const content=zip([file('manifest.json',json(manifest)),...files]),identity=sha256Bytes(content);
  return {name:filename(edition.customer,edition.delivery_type,edition.prepared_at,customerIdentity),
    type:'application/zip',content,...identity,edition_sha256};
}
