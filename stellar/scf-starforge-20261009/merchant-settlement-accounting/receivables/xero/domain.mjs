// MIT. Template-based Xero sales documents from original merchant receivables.
import {json, sha, need, plain, field, identifier, dateValue, currencyOf, currencyKey,
  minor, money, csv, INVOICE_SCHEMA, CREDIT_SCHEMA} from '../core.mjs';
import {cwDecode, readCryptoworthCsv, writeCryptoworthCsv} from '../../accountant/cryptoworth-csv.mjs';

export const XERO_SCHEMA = 'stellar-forge.merchant-receivables-xero.v1';
export const XERO_PROFILE_SCHEMA = 'stellar-forge.merchant-receivables-xero-profile.v1';
export const XERO_PACKAGE_SCHEMA = 'stellar-forge.merchant-receivables-xero-package.v1';
export const XERO_RESULT_SCHEMA = 'stellar-forge.merchant-receivables-xero-result.v1';
export const XERO_REQUEST_BYTES = 32 * 1024 * 1024;
export const XERO_TEMPLATE_BYTES = 256 * 1024;
export const XERO_RETURN_BYTES = 8 * 1024 * 1024;
export const XERO_PACKAGE_BYTES = 128 * 1024 * 1024;
export const XERO_MAX_DOCUMENTS = 500;
export const XERO_ROWS_PER_FILE = 500;
const REQUIRED = ['ContactName','InvoiceNumber','InvoiceDate','DueDate','Description',
  'Quantity','UnitAmount','AccountCode','TaxType','Currency'];
const FORMATS = new Set(['DD/MM/YYYY','MM/DD/YYYY']);
const HEX = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const file = (name, bytes, role, type) => ({name, bytes:Buffer.from(bytes), role,
  type:type ?? (name.endsWith('.csv')?'text/csv; charset=utf-8':
    name.endsWith('.html')?'text/html; charset=utf-8':
    name.endsWith('.json')?'application/json; charset=utf-8':'text/plain; charset=utf-8')});
export const xeroFileDescriptor = item => ({name:item.name,type:item.type,role:item.role,
  bytes:item.bytes.length,sha256:sha(item.bytes),...(item.documentIds?{documentIds:item.documentIds,rowCount:item.rowCount}:{} )});
export function xeroInstant(value, name = 'received time') {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value),
    'INVALID_XERO_TIME','Use a complete UTC '+name+'.');
  const normalized=value.replace(/(?:\.(\d{1,3}))?Z$/,(_,v)=>'.'+(v??'').padEnd(3,'0')+'Z');
  need(Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===normalized,
    'INVALID_XERO_TIME','Check the calendar fields in '+name+'.');
  return normalized;
}
export function decodeXeroFile(value, maximum = XERO_RETURN_BYTES) {
  try { return cwDecode(value,{max:maximum}); }
  catch(error) { error.code=String(error.code??'INVALID_CSV').replace(/CRYPTOWORTH/g,'XERO'); throw error; }
}
export function readXeroCsv(bytes) {
  try { return readCryptoworthCsv(bytes,{delimiter:','}); }
  catch(error) { error.code=String(error.code??'INVALID_CSV').replace(/CRYPTOWORTH/g,'XERO'); throw error; }
}
function template(value, kind) {
  const original=decodeXeroFile(value,XERO_TEMPLATE_BYTES), parsed=readXeroCsv(original.bytes);
  need(parsed.records.every(row=>row.values.length===parsed.headers.length),
    'XERO_TEMPLATE_ROW_WIDTH','The original '+kind+' template has a row with a different field count.');
  const keys=parsed.headers.map(header=>header.startsWith('*')?header.slice(1):header);
  need(new Set(keys).size===keys.length,'XERO_TEMPLATE_DUPLICATE_FIELD',
    'The original '+kind+' template repeats a field with or without its required marker.');
  for(const key of REQUIRED) need(keys.includes(key),'XERO_TEMPLATE_FIELD_REQUIRED',
    'The complete '+kind+' template needs its original '+key+' column.');
  const headers=[...parsed.headers];
  if(!keys.includes('TaxAmount')){headers.push('TaxAmount');keys.push('TaxAmount');}
  return {metadata:{name:original.name,bytes:original.bytes.length,sha256:original.sha256,
    headers:parsed.headers,outputHeaders:headers,keys,delimiter:',',newline:parsed.newline??'\r\n',
    bom:parsed.bom,taxAmountAdded:!parsed.headers.some(h=>h.replace(/^\*/,'')==='TaxAmount')},
    source:file(kind+'-template.csv',original.bytes,'original-template')};
}
export function normalizeXeroProfile(value,{id,version}) {
  need(plain(value),'INVALID_XERO_PROFILE','Send the Xero organisation and original templates.');
  identifier(id,'Xero profile');
  need(Number.isSafeInteger(version)&&version>0,'INVALID_XERO_PROFILE_VERSION','Use a saved profile version.');
  const currency=currencyOf(value.currency);
  need(currency.scale<=2,'XERO_CURRENCY_PRECISION',
    'Use the accounting currency precision supported by this Xero document handover (zero to two places).');
  need(FORMATS.has(value.invoiceDateFormat)&&FORMATS.has(value.creditDateFormat),
    'XERO_DATE_FORMAT_REQUIRED','Choose the actual invoice and credit-template date conventions.');
  const invoice=template(value.invoiceTemplate,'invoice'),credit=template(value.creditTemplate,'credit');
  need(Array.isArray(value.contacts??[])&&(value.contacts??[]).length<=5000,
    'INVALID_XERO_CONTACTS','Map up to 5,000 existing customers to their exact Xero contact names.');
  const contactIds=new Set();
  const contacts=(value.contacts??[]).map(row=>{
    need(plain(row),'INVALID_XERO_CONTACT','Use a complete customer/contact mapping.');
    const customerId=identifier(row.customerId,'customer');
    need(!contactIds.has(customerId),'DUPLICATE_XERO_CONTACT','Map each accounting customer once.');
    contactIds.add(customerId);
    return {customerId,contactName:field(row.contactName,'exact Xero contact name',255)};
  });
  need(Array.isArray(value.lineMappings??[])&&(value.lineMappings??[]).length<=20000,
    'INVALID_XERO_LINE_MAPPINGS','Use the original document and line IDs for mapping overrides.');
  const mapped=new Set();
  const lineMappings=(value.lineMappings??[]).map(row=>{
    need(plain(row),'INVALID_XERO_LINE_MAPPING','Use one complete document-line mapping.');
    const documentId=identifier(row.documentId,'invoice or credit note');
    const lineId=field(row.lineId,'original line ID',80),key=documentId+':'+lineId;
    need(!mapped.has(key),'DUPLICATE_XERO_LINE_MAPPING','Map each original document line once.');mapped.add(key);
    return {documentId,lineId,accountCode:field(row.accountCode,'Xero account code',50),
      taxType:field(row.taxType,'exact Xero tax-rate display name',200)};
  });
  const profile={schema:XERO_PROFILE_SCHEMA,id,version,name:field(value.name,'profile name',200),
    organisation:field(value.organisation,'Xero organisation',300),currency,
    invoiceDateFormat:value.invoiceDateFormat,creditDateFormat:value.creditDateFormat,
    accountCode:field(value.accountCode,'default Xero account code',50),
    taxType:field(value.taxType,'exact default Xero tax-rate display name',200),
    contacts,lineMappings,invoiceTemplate:invoice.metadata,creditTemplate:credit.metadata,
    lineRepresentation:'NET_LINE',taxBasis:'EXCLUSIVE'};
  return {profile,files:[invoice.source,credit.source]};
}
export function publicXeroProfile(profile) {
  const result=clone(profile);
  for(const key of ['invoiceTemplate','creditTemplate']) {
    delete result[key]?.keys;
    delete result[key]?.outputHeaders;
  }
  return result;
}
export function xeroDate(value,format) {
  dateValue(value,'document date');
  const [year,month,day]=value.split('-');
  return format==='MM/DD/YYYY'?month+'/'+day+'/'+year:day+'/'+month+'/'+year;
}
function mapping(profile,doc,line) {
  const lineId=line.id??line.invoiceLineId;
  return profile.lineMappings.find(row=>row.documentId===doc.id&&row.lineId===lineId) ??
    (doc.kind==='CREDIT_NOTE'?profile.lineMappings.find(row=>row.documentId===doc.invoiceId&&row.lineId===lineId):null) ??
    {accountCode:profile.accountCode,taxType:profile.taxType};
}
function totals(currency) {return {net:0n,tax:0n,total:0n,currency};}
function finishTotal(value) {return {net:money(value.net,value.currency),tax:money(value.tax,value.currency),total:money(value.total,value.currency)};}
function rowsFile(profile,kind,groups) {
  const selected=kind==='INVOICE'?profile.invoiceTemplate:profile.creditTemplate;
  const output=[];let rows=[],documents=[],index=1;
  const flush=()=>{
    if(!rows.length)return;
    const name=(kind==='INVOICE'?'xero-invoices-':'xero-credits-')+String(index++).padStart(3,'0')+'.csv';
    const bytes=writeCryptoworthCsv(selected.outputHeaders,rows,{delimiter:',',newline:selected.newline,bom:selected.bom});
    output.push({...file(name,bytes,'xero-draft-import'),documentIds:documents,rowCount:rows.length,taxBasis:'EXCLUSIVE'});
    rows=[];documents=[];
  };
  for(const group of groups) {
    need(group.rows.length<=XERO_ROWS_PER_FILE,'XERO_DOCUMENT_ROW_LIMIT',
      'One document exceeds the per-file import row limit.');
    if(rows.length+group.rows.length>XERO_ROWS_PER_FILE)flush();
    rows.push(...group.rows);documents.push(group.documentId);
  }
  flush();return output;
}
export function compileXeroPackage(profile,originals,snapshot,selection,additionalFiles=[]) {
  need(profile?.schema===XERO_PROFILE_SCHEMA,'XERO_PROFILE_REQUIRED','Choose a saved Xero profile.');
  need(Array.isArray(originals)&&originals.length>0&&originals.length<=XERO_MAX_DOCUMENTS,
    'XERO_DOCUMENT_SELECTION','Select between one and '+XERO_MAX_DOCUMENTS+' issued documents.');
  dateValue(selection.asOf,'account date');
  const issues=[],documents=[],sourceFiles=[],correspondence=[],groups={INVOICE:[],CREDIT_NOTE:[]};
  const sum={INVOICE:totals(profile.currency),CREDIT_NOTE:totals(profile.currency)};
  const numberIds=new Map(),seen=new Set();
  const issue=(code,message,documentId,lineId)=>issues.push({code,message,...(documentId?{documentId}:{}),...(lineId?{lineId}:{})});
  for(const original of originals) {
    const doc=original.document;
    need(plain(doc)&&[INVOICE_SCHEMA,CREDIT_SCHEMA].includes(doc.schema)&&['INVOICE','CREDIT_NOTE'].includes(doc.kind),
      'ORIGINAL_XERO_DOCUMENT_REQUIRED','Use the original issued invoice or credit JSON.');
    identifier(doc.id,'issued document');
    need(!seen.has(doc.id),'DUPLICATE_XERO_DOCUMENT','Select each document once.');seen.add(doc.id);
    need(HEX.test(original.sourceSha256??''),'ORIGINAL_XERO_DOCUMENT_HASH','Retain the original issued JSON identity.');
    const before=issues.length,credit=doc.kind==='CREDIT_NOTE',date=credit?doc.creditDate:doc.issueDate;
    if(original.status==='VOID')issue('XERO_VOID_DOCUMENT','This document is void; select its issued correction.',doc.id);
    if(date>selection.asOf)issue('XERO_FUTURE_DOCUMENT','This document is after the selected account date.',doc.id);
    if(currencyKey(doc.currency)!==currencyKey(profile.currency))issue('XERO_CURRENCY_MISMATCH','The document currency differs from the selected organisation profile.',doc.id);
    if(numberIds.has(doc.number))issue('XERO_NUMBER_COLLISION','Invoice and credit numbers must be unique in the import selection.',doc.id);
    numberIds.set(doc.number,doc.id);
    if(original.previouslyImported)issue('XERO_DOCUMENT_ALREADY_IMPORTED','The original document already has a received Xero ID; open that saved result.',doc.id);
    if(original.preparedElsewhere)issue('XERO_DOCUMENT_ALREADY_PREPARED','This original is already in package '+original.preparedElsewhere+'. Continue from that package.',doc.id);
    if(original.requiresReturnedCorrection)issue('XERO_RECEIVED_DOCUMENT_REVIEW','This original has an accepted or conflicting Xero ID. Correct the existing draft and receive its complete result against the saved package.',doc.id);
    const contact=profile.contacts.find(row=>row.customerId===doc.customer.id);
    if(!contact)issue('XERO_CONTACT_MAPPING_REQUIRED','Map '+doc.customer.name+' to its exact Xero contact name.',doc.id);
    const selected=credit?profile.creditTemplate:profile.invoiceTemplate;
    const rowLines=[];
    for(const line of doc.lines) {
      const lineId=line.id??line.invoiceLineId,mapped=mapping(profile,doc,line);
      const net=minor(line.netAmount,doc.currency),tax=minor(line.taxAmount,doc.currency);
      need(net+tax===minor(line.total,doc.currency),'XERO_ORIGINAL_LINE_CHANGED','The original line net and tax do not match its total.',409);
      const description=credit?line.description+' | Credit against '+doc.invoiceNumber+'; original line '+lineId:
        line.description+' | Original quantity '+line.quantity+' × '+line.unitAmount+
          '; discount '+line.discountAmount+'; line '+lineId;
      const values={ContactName:contact?.contactName??'',InvoiceNumber:doc.number,
        InvoiceDate:xeroDate(date,credit?profile.creditDateFormat:profile.invoiceDateFormat),
        DueDate:xeroDate(credit?date:doc.dueDate,credit?profile.creditDateFormat:profile.invoiceDateFormat),
        Reference:credit?doc.invoiceNumber:(doc.purchaseOrder||doc.sourceReference||''),
        Description:description,Quantity:'1',UnitAmount:money(credit?-net:net,doc.currency),
        AccountCode:mapped.accountCode,TaxType:mapped.taxType,Currency:doc.currency.code,
        TaxAmount:money(credit?-tax:tax,doc.currency),Discount:''};
      rowLines.push(selected.keys.map(key=>values[key]??''));
      correspondence.push([doc.id,doc.kind,doc.number,lineId,doc.customer.id,contact?.contactName??'',
        line.quantity??'',line.unitAmount??'',line.discountAmount??'',line.netAmount,line.taxAmount,line.total,
        mapped.accountCode,mapped.taxType,values.Quantity,values.UnitAmount,values.TaxAmount,original.sourceSha256]);
    }
    if(credit&&doc.lines.some(line=>minor(line.netAmount,doc.currency)===0n))
      issue('XERO_TAX_ONLY_CREDIT','The CSV credit contract requires a negative unit amount. Retain a credit containing a tax-only line for the organisation’s tax-adjustment workflow.',doc.id);
    const net=minor(doc.totals.net,doc.currency),tax=minor(doc.totals.tax,doc.currency),total=minor(doc.totals.total,doc.currency);
    need(net+tax===total,'XERO_ORIGINAL_TOTAL_CHANGED','The original document net and tax do not match its total.',409);
    documents.push({id:doc.id,kind:doc.kind,number:doc.number,customerId:doc.customer.id,customerName:doc.customer.name,
      contactName:contact?.contactName??'',currency:clone(doc.currency),date,
      net:money(net,doc.currency),tax:money(tax,doc.currency),total:money(total,doc.currency),
      lineCount:doc.lines.length,sourceSha256:original.sourceSha256,
      invoiceId:credit?doc.invoiceId:null,invoiceNumber:credit?doc.invoiceNumber:null});
    if(issues.length===before) {
      groups[doc.kind].push({documentId:doc.id,rows:rowLines});
      sum[doc.kind].net+=net;sum[doc.kind].tax+=tax;sum[doc.kind].total+=total;
    }
    for(const item of original.files) sourceFiles.push(file('source-'+doc.id+'-'+item.name,item.bytes,'original-issued-document',item.type));
  }
  const normalizedSelection={profileId:profile.id,profileVersion:profile.version,documentIds:originals.map(v=>v.document.id),
    asOf:selection.asOf,...(selection.parentId?{parentId:selection.parentId}:{})};
  const sourceFingerprint=sha(json({profile,documents,snapshot,selection:normalizedSelection,additionalFiles:additionalFiles.map(xeroFileDescriptor)}));
  const review={schema:'stellar-forge.merchant-receivables-xero-review.v1',ready:issues.length===0,issues,
    selection:normalizedSelection,profile:publicXeroProfile(profile),documents,
    totals:{currency:clone(profile.currency),invoices:finishTotal(sum.INVOICE),credits:finishTotal(sum.CREDIT_NOTE)},
    sourceFingerprint,lineRepresentation:'NET_LINE',taxBasis:'EXCLUSIVE'};
  const files=[...rowsFile(profile,'INVOICE',groups.INVOICE),...rowsFile(profile,'CREDIT_NOTE',groups.CREDIT_NOTE),
    ...sourceFiles,...additionalFiles,file('original-account-snapshot.json',json(snapshot),'original-customer-account'),
    file('line-correspondence.csv',csv([['document_id','kind','document_number','original_line_id','customer_id',
      'xero_contact','original_quantity','original_unit_amount','original_discount','original_net','original_tax',
      'original_total','account_code','tax_type','xero_quantity','xero_unit_amount','xero_tax_amount','original_document_sha256'],
      ...correspondence]),'source-line-correspondence'),
    file('profile.json',json(publicXeroProfile(profile)),'selected-profile'),
    file('document-register.json',json({schema:XERO_PACKAGE_SCHEMA,selection:normalizedSelection,documents}),'document-register')];
  if(Array.isArray(snapshot.receipts))files.push(file('receipt-schedule.csv',csv([
    ['receipt_id','customer_id','reference','received_date','currency','amount','void_date','method','source_kind'],
    ...snapshot.receipts.map(row=>[row.id,row.customerId,row.reference,row.receivedDate,row.currency.code,row.amount,
      row.voidDate??'',row.method,row.source?.kind??''])]),'payment-reconciliation'));
  if(Array.isArray(snapshot.allocations))files.push(file('allocation-schedule.csv',csv([
    ['allocation_id','receipt_id','invoice_id','allocated_date','released_date','currency','amount','active_on_account_date'],
    ...snapshot.allocations.map(row=>[row.id,row.receiptId,row.invoiceId,row.allocatedDate,row.releasedDate??'',
      row.currency.code,row.amount,String(row.allocatedDate<=selection.asOf&&(!row.releasedDate||row.releasedDate>selection.asOf))])]),
    'payment-reconciliation'));
  review.files=files.map(xeroFileDescriptor);
  review.previewSha256=sha(json(review));
  files.push(file('review.json',json(review),'review'));
  files.push(file('review.html',renderXeroReview(review),'operator-review'));
  return {review,files};
}
export function renderXeroReview(review) {
  const e=escape;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Xero receivables handover</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#222;margin:32px auto;max-width:1100px;padding:0 24px}'+
    'h1{font-size:28px}h2{font-size:18px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #bbb}'+
    '.number{text-align:right;font-variant-numeric:tabular-nums}code{overflow-wrap:anywhere}footer{margin-top:24px;border-top:1px solid #aaa;padding-top:14px}</style></head><body>'+
    '<h1>Xero receivables handover</h1><p>'+e(review.profile.organisation)+' · '+e(review.profile.name)+' v'+review.profile.version+
    ' · Account date '+e(review.selection.asOf)+'</p><p>'+e(review.ready?'Ready for the reviewed draft import':'Resolve the selected document issues')+'</p>'+
    (review.issues.length?'<ul>'+review.issues.map(row=>'<li>'+e(row.message)+'</li>').join('')+'</ul>':'')+
    '<table><thead><tr><th>Document</th><th>Kind</th><th>Xero contact</th><th>Date</th><th class="number">Net</th><th class="number">Tax</th><th class="number">Total</th></tr></thead><tbody>'+
    review.documents.map(row=>'<tr><td>'+e(row.number)+'</td><td>'+e(row.kind)+'</td><td>'+e(row.contactName)+'</td><td>'+e(row.date)+'</td>'+
      '<td class="number">'+e(row.net)+'</td><td class="number">'+e(row.tax)+'</td><td class="number">'+e(row.total)+' '+e(row.currency.code)+'</td></tr>').join('')+
    '</tbody></table><h2>Receiving procedure</h2><ol><li>Confirm the selected Xero organisation, exact contact names, account codes, tax names and regional dates.</li>'+
    '<li>Import the invoice files and credit files as tax-exclusive draft documents. Each file keeps complete documents within 500 rows.</li>'+
    '<li>Compare original net, tax and total values. Each import line uses one unit at its original net value; the original quantity, rate and discount remain in its description and complete source correspondence.</li>'+
    '<li>Retain Xero’s returned document IDs, statuses, totals and errors in their original CSV. Record that complete file against this package.</li>'+
    '<li>Use a corrected profile and the original package to prepare unresolved documents. The saved source and all earlier outcomes remain available.</li>'+
    '<li>Use the separate receipt and allocation schedules to reconcile collections with the imported sales documents.</li></ol>'+
    '<footer>Profile and original source <code>'+e(review.sourceFingerprint)+'</code><br>Review <code>'+e(review.previewSha256)+'</code></footer></body></html>\n';
}
function externalMoney(value,currency,format,credit) {
  let text=field(value,'returned document amount',100);
  const decimal=format.decimalSeparator,group=format.groupSeparator;
  let sign=1n;
  if(text.startsWith('-')){sign=-1n;text=text.slice(1);}
  need(/^[0-9., ]+$/.test(text),'XERO_RETURN_AMOUNT','Use original numeric fields with the selected decimal and grouping separators.');
  const parts=text.split(decimal);
  need(parts.length<=2&&parts[0].length>0&&(!parts[1]||/^\d+$/.test(parts[1])),
    'XERO_RETURN_AMOUNT','The returned amount does not match its selected decimal separator.');
  let whole=parts[0];
  if(group&&whole.includes(group)){
    const groups=whole.split(group);
    need(/^\d{1,3}$/.test(groups[0])&&groups.slice(1).every(v=>/^\d{3}$/.test(v)),
      'XERO_RETURN_GROUPING','The returned amount has invalid thousands grouping.');
    whole=groups.join('');
  }
  need(/^\d+$/.test(whole),'XERO_RETURN_AMOUNT','The returned amount contains an unselected separator.');
  whole=whole.replace(/^0+(?=\d)/,'');
  const canonical=(sign<0n?'-':'')+whole+(parts.length===2?'.'+parts[1]:'');
  let amount=minor(canonical,currency,'returned amount',{signed:true});
  if(credit&&format.creditSign==='NEGATIVE')amount=-amount;
  need(amount>=0n,'XERO_RETURN_SIGN','The returned credit or invoice amount has the opposite sign from the selected convention.');
  return money(amount,currency);
}
function statusChoices(value,name,fallback) {
  const choices=value??fallback;
  need(Array.isArray(choices)&&choices.length>0&&choices.length<=30&&
    choices.every(v=>typeof v==='string'&&v.trim().length>0),
    'XERO_RETURN_STATUS_REQUIRED','Choose the original '+name+' statuses.');
  return [...new Set(choices.map(v=>v.trim()))];
}
/** Evaluate original document-summary rows or native API records without changing the source bytes. */
export function evaluateXeroReturnRows(records,documents,options={}) {
  need(Array.isArray(records)&&records.length>0,'XERO_RETURN_EMPTY','Use a complete provider result containing original documents.');
  const importedStatusValues=statusChoices(options.importedStatusValues,'imported',['DRAFT','AUTHORISED','PAID']);
  const retiredStatusValues=statusChoices(options.retiredStatusValues,'voided or deleted',['VOIDED','DELETED']);
  const accepted=new Set(importedStatusValues),retired=new Set(retiredStatusValues);
  need(retiredStatusValues.every(v=>!accepted.has(v)),'XERO_RETURN_STATUS_OVERLAP','Imported and retired statuses must be different.');
  const format={decimalSeparator:options.decimalSeparator??'.',groupSeparator:options.groupSeparator??'',creditSign:options.creditSign??'POSITIVE'};
  need(['.',','].includes(format.decimalSeparator)&&['',',','.',' '].includes(format.groupSeparator)&&
    format.decimalSeparator!==format.groupSeparator&&['POSITIVE','NEGATIVE'].includes(format.creditSign),
    'XERO_RETURN_NUMBER_FORMAT','Choose distinct decimal/grouping separators and the original credit sign convention.');
  const byNumber=new Map(documents.map(doc=>[doc.number,doc])),groups=new Map(),unmatchedRows=[],unmatchedPointers=[];
  for(const source of records) {
    need(plain(source),'INVALID_XERO_RETURN_RECORD','Use one complete original returned document record.');
    const rowNumbers=Array.isArray(source.rowNumbers)?source.rowNumbers:[],
      sourcePointers=Array.isArray(source.sourcePointers)?source.sourcePointers:[];
    const get=key=>String(source[key]??'');
    const doc=byNumber.get(get('documentNumber').trim());
    if(!doc){unmatchedRows.push(...rowNumbers);unmatchedPointers.push(...sourcePointers);continue;}
    const externalStatus=get('externalStatus').trim(),externalDocumentId=get('externalDocumentId').trim().toLowerCase();
    const validId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(externalDocumentId)&&externalDocumentId!=='00000000-0000-0000-0000-000000000000';
    const row={rowNumbers:[...rowNumbers],sourcePointers:[...sourcePointers],documentId:doc.id,
      documentNumber:doc.number,sourceSha256:doc.sourceSha256,externalDocumentId,externalStatus,
      status:'REJECTED',error:get('error').trim(),net:get('net'),tax:get('tax'),total:get('total'),currency:get('currency').trim(),
      retired:retired.has(externalStatus)&&source.providerRejected!==true,providerRejected:source.providerRejected===true,externalDocumentIds:[],externalRecords:[]};
    if(row.providerRejected) {
      row.status='REJECTED';row.error=row.error||'The original Xero response rejected this document.';
    } else if(accepted.has(externalStatus)) {
      try {
        need(validId,'XERO_RETURN_DOCUMENT_ID','A successful row needs its original Xero document UUID.');
        need(row.currency===doc.currency.code,'XERO_RETURN_CURRENCY','The returned currency differs from the issued source.');
        for(const key of ['net','tax','total']) {
          row[key]=externalMoney(get(key),doc.currency,format,doc.kind==='CREDIT_NOTE');
          need(row[key]===doc[key],'XERO_RETURN_TOTAL','The returned '+key+' differs from the original issued document.');
        }
        need(!row.error,'XERO_RETURN_ERROR','A successful status also carries a returned error: '+row.error);
        row.status='IMPORTED';
      } catch(error){row.status='MISMATCH';row.error=error.message;}
    } else if(row.retired) {
      if(validId)row.error='Xero reports this document as '+externalStatus+'.';
      else {row.status='MISMATCH';row.error='A voided or deleted return needs its original Xero document UUID.';}
    } else if(!row.error)row.error=externalStatus?'Returned status: '+externalStatus:'The returned status is empty.';
    if(validId&&!row.providerRejected&&(accepted.has(externalStatus)||row.retired)) {
      row.externalDocumentIds=[externalDocumentId];
      row.externalRecords=[{externalDocumentId,externalStatus,kind:row.retired?'RETIRED':'ACCEPTED',
        outcome:row.status,error:row.error,net:row.net,tax:row.tax,total:row.total,currency:row.currency,
        rowNumbers:[...rowNumbers],sourcePointers:[...sourcePointers]}];
    }
    if(!groups.has(doc.id))groups.set(doc.id,[]);
    groups.get(doc.id).push(row);
  }
  need(groups.size>0,'XERO_RETURN_SELECTION','This returned file contains none of the original selected document numbers.');
  const rows=[];
  for(const group of groups.values()) {
    const events=group.flatMap(row=>row.externalRecords),active=new Map();
    for(const event of events) {
      if(event.kind==='RETIRED')active.delete(event.externalDocumentId);
      else active.set(event.externalDocumentId,event);
    }
    let result=clone(group.at(-1));
    if(active.size===1) {
      const event=[...active.values()][0];
      const original=group.findLast(row=>!row.retired&&row.externalDocumentId===event.externalDocumentId);
      if(original)result=clone(original);
      const shapes=new Set(group.filter(row=>!row.retired).map(row=>json({
        externalDocumentId:row.externalDocumentId,externalStatus:row.externalStatus,status:row.status,
        error:row.error,net:row.net,tax:row.tax,total:row.total,currency:row.currency})));
      if(shapes.size>1){result.status='CONFLICT';result.error='The returned file contains conflicting active rows for this original document.';}
    } else if(active.size>1) {
      result.status='CONFLICT';result.error='The returned file contains multiple active Xero document IDs for this original.';
    }
    result.rowNumbers=[...new Set(group.flatMap(row=>row.rowNumbers))];
    result.sourcePointers=[...new Set(group.flatMap(row=>row.sourcePointers))];
    result.externalDocumentIds=[...new Set(events.map(event=>event.externalDocumentId))];
    result.externalRecords=events;result.activeExternalDocumentIds=[...active.keys()];
    rows.push(result);
  }
  const owners=new Map();
  for(const row of rows)for(const id of row.activeExternalDocumentIds) {
    if(!owners.has(id))owners.set(id,new Set());
    owners.get(id).add(row.documentId);
  }
  for(const row of rows)if(row.activeExternalDocumentIds.some(id=>owners.get(id).size>1)) {
    row.status='CONFLICT';row.error='One Xero document ID is assigned to different original documents in this returned file.';
  }
  return {...format,importedStatusValues,retiredStatusValues,rows,unmatchedRows:[...new Set(unmatchedRows)],
    unmatchedPointers:[...new Set(unmatchedPointers)],sourceRowCount:records.length};
}
export function readXeroResults(value,documents) {
  need(plain(value)&&plain(value.columns),'XERO_RETURN_MAPPING_REQUIRED','Map the original returned CSV fields.');
  const original=decodeXeroFile(value.file),parsed=readXeroCsv(original.bytes);
  const roles=['documentNumber','documentId','status','net','tax','total','currency','error'],columns={};
  for(const role of roles) {
    const heading=value.columns[role];
    if(role==='error'&&(heading===undefined||heading===''))continue;
    need(typeof heading==='string'&&parsed.headers.includes(heading),'XERO_RETURN_COLUMN_REQUIRED',
      'Choose the original '+role+' column.');columns[role]=heading;
  }
  need(new Set(Object.values(columns)).size===Object.keys(columns).length,'XERO_RETURN_COLUMN_REUSED',
    'Use a distinct original column for each returned field.');
  const records=parsed.records.map(source=>{
    need(source.values.length===parsed.headers.length,'XERO_RETURN_ROW_WIDTH','A returned CSV row has a different field count from its header.');
    const get=role=>columns[role]===undefined?'':source.values[parsed.headers.indexOf(columns[role])];
    return {rowNumbers:[source.rowNumber],sourcePointers:[],documentNumber:get('documentNumber'),
      externalDocumentId:get('documentId'),externalStatus:get('status'),net:get('net'),tax:get('tax'),
      total:get('total'),currency:get('currency'),error:get('error')};
  });
  return {schema:XERO_RESULT_SCHEMA,format:'CSV_SUMMARY',file:{name:original.name,bytes:original.bytes.length,sha256:original.sha256},
    bytes:original.bytes,columns,...evaluateXeroReturnRows(records,documents,value)};
}
