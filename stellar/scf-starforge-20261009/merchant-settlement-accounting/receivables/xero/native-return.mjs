// MIT. Original Xero Accounting API responses into the maintained receiving evaluator.
import {TextDecoder} from 'node:util';
import {need, plain} from '../core.mjs';
import {decodeXeroFile, evaluateXeroReturnRows, XERO_RESULT_SCHEMA} from './domain.mjs';
import {parseXeroNativeJson} from './public/native-json.mjs';

export const XERO_NATIVE_RETURN_SCHEMA = 'stellar-forge.merchant-receivables-xero-native-return.v1';
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const has = (value, key) => Object.hasOwn(value, key);
const pointerChild = (pointer, key) => pointer + '/' + String(key).replace(/~/g,'~0').replace(/\//g,'~1');
const sourceText = value => typeof value === 'string' ? value : '';
const fieldPointers = (value, pointer) =>
  Object.fromEntries(Object.keys(value).map(key => [key, pointerChild(pointer,key)]));
const array = value => Array.isArray(value) ? value : [];

/** Expand an original JSON decimal/exponent exactly; no amount passes through Number. */
function exactDecimal(value, pointer) {
  if (value === undefined || value === null) return '';
  need(typeof value === 'string' && value.length <= 2048,
    'XERO_NATIVE_AMOUNT', 'The original monetary field is not a JSON number or decimal string at ' + pointer + '.');
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  need(match, 'XERO_NATIVE_AMOUNT', 'The original monetary field is not an exact JSON decimal at ' + pointer + '.');
  const exponentText = match[4] ?? '0';
  const exponentDigits = exponentText.replace(/^[+-]/,'').replace(/^0+(?=\d)/,'');
  need(exponentDigits.length <= 4,
    'XERO_NATIVE_AMOUNT_RANGE', 'The original monetary exponent is outside the receiving range at ' + pointer + '.');
  // Only a bounded exponent, never a monetary coefficient, is represented as Number.
  const exponent = Number(exponentText);
  need(Number.isInteger(exponent) && Math.abs(exponent) <= 1000,
    'XERO_NATIVE_AMOUNT_RANGE', 'The original monetary exponent is outside the receiving range at ' + pointer + '.');
  let digits = match[2] + (match[3] ?? ''), point = match[2].length + exponent;
  if (/^0+$/.test(digits)) return '0';
  let whole, fraction;
  if (point <= 0) { whole = '0'; fraction = '0'.repeat(-point) + digits; }
  else if (point >= digits.length) { whole = digits + '0'.repeat(point-digits.length); fraction = ''; }
  else { whole = digits.slice(0,point); fraction = digits.slice(point); }
  whole = whole.replace(/^0+(?=\d)/,'');
  fraction = fraction.replace(/0+$/,'');
  const canonical = match[1] + whole + (fraction ? '.' + fraction : '');
  need(canonical.length <= 100, 'XERO_NATIVE_AMOUNT_RANGE',
    'The original monetary amount exceeds the exact receiving range at ' + pointer + '.');
  return canonical;
}
function providerErrors(original, pointer, envelope, collection) {
  const messages = [], references = [];
  let providerRejected = original.HasErrors === true || collection === 'Elements';
  if (has(original,'HasErrors') && typeof original.HasErrors !== 'boolean') {
    providerRejected = true;
    messages.push('The original HasErrors value is not boolean.');
    references.push(pointerChild(pointer,'HasErrors'));
  }
  if (has(original,'ValidationErrors') && !Array.isArray(original.ValidationErrors)) {
    providerRejected = true;
    messages.push('The original ValidationErrors value is not an array.');
    references.push(pointerChild(pointer,'ValidationErrors'));
  }
  for (const [index, error] of array(original.ValidationErrors).entries()) {
    providerRejected = true;
    const errorPointer = pointerChild(pointerChild(pointer,'ValidationErrors'),index);
    references.push(errorPointer);
    const message = plain(error) ? sourceText(error.Message) : sourceText(error);
    messages.push(message || 'Xero returned a validation error at ' + errorPointer + '.');
  }
  // Xero's validation exception envelope is the provider's rejected operation,
  // including submitted Elements that may still contain DRAFT and placeholder IDs.
  if (collection === 'Elements' && (envelope.Type === 'ValidationException' ||
      (has(envelope,'ErrorNumber') && sourceText(envelope.ErrorNumber) !== '0'))) {
    providerRejected = true;
    if (sourceText(envelope.Message)) messages.push(envelope.Message);
  }
  if (providerRejected && messages.length === 0)
    messages.push(collection === 'Elements' ? 'Xero returned this original document in a validation response.' :
      'Xero reports HasErrors for this original document.');
  return {providerRejected, messages:[...new Set(messages)], pointers:references};
}
function identify(original, collection) {
  const type = sourceText(original.Type), candidate = type === 'ACCREC' ? 'INVOICE' :
    type === 'ACCRECCREDIT' ? 'CREDIT_NOTE' : null;
  if (candidate && ((collection === 'Invoices' && candidate === 'INVOICE') ||
      (collection === 'CreditNotes' && candidate === 'CREDIT_NOTE') || collection === 'Elements'))
    return {kind:candidate, type, kindSource:'Type', excludedReason:null};
  // Original rejected Elements sometimes repeat only fields supplied in the failed request.
  if (collection === 'Elements' && !type) {
    const invoiceFields = has(original,'InvoiceNumber') || has(original,'InvoiceID');
    const creditFields = has(original,'CreditNoteNumber') || has(original,'CreditNoteID');
    if (invoiceFields !== creditFields)
      return {kind:invoiceFields?'INVOICE':'CREDIT_NOTE', type, kindSource:'rejected element fields',
        excludedReason:null};
  }
  return {kind:candidate, type, kindSource:'Type',
    excludedReason:!type ? 'The original document has no explicit receivables Type.' :
      candidate ? 'The returned document Type does not match its response collection.' :
      'The original Type ' + type + ' is outside sales invoices and customer credit notes.'};
}
function documentSource(original, collection, index, envelope, selected, acceptedStatuses) {
  const pointer = '/' + collection + '/' + index;
  need(plain(original), 'XERO_NATIVE_DOCUMENT', 'The original document at ' + pointer + ' must be a JSON object.');
  const identified = identify(original,collection), kind = identified.kind;
  const creditFields = kind === 'CREDIT_NOTE' || collection === 'CreditNotes' ||
    (!kind && (has(original,'CreditNoteNumber') || has(original,'CreditNoteID')));
  const numberField = creditFields ? 'CreditNoteNumber' : 'InvoiceNumber';
  const idField = creditFields ? 'CreditNoteID' : 'InvoiceID';
  const number = sourceText(original[numberField]), id = sourceText(original[idField]);
  const issues = [], canonical = {};
  const moneyFields = {net:'SubTotal', tax:'TotalTax', total:'Total', rounding:'RoundingAmount'};
  const amounts = Object.fromEntries(Object.entries(moneyFields).map(([role,key]) =>
    [role, sourceText(original[key])]));
  for (const [role,key] of Object.entries(moneyFields)) {
    try { canonical[role] = exactDecimal(original[key],pointerChild(pointer,key)); }
    catch(error) { canonical[role] = sourceText(original[key]); issues.push(error.message); }
  }
  const errors = providerErrors(original,pointer,envelope,collection);
  const matching = selected.get(number.trim());
  if (matching && kind && kind !== matching.kind)
    issues.push('The native document Type differs from the selected original ' + matching.kind + '.');
  if (matching && !errors.providerRejected && acceptedStatuses.has(sourceText(original.Status).trim())) {
    const nativeContactName = plain(original.Contact) ? sourceText(original.Contact.Name).trim() : '';
    if (!nativeContactName)
      issues.push('The successful detailed native response is missing its original Contact.Name.');
    else if (nativeContactName !== matching.contactName)
      issues.push('The native Contact.Name differs from the selected original contact ' + matching.contactName + '.');
  }
  if (id.toLowerCase() === ZERO_GUID && !errors.providerRejected)
    issues.push('A placeholder all-zero Xero UUID cannot identify an imported document.');
  if (has(original,'LineItems') && !Array.isArray(original.LineItems))
    issues.push('The original LineItems value is not an array.');
  const lineItems = array(original.LineItems).map((line,lineIndex) => {
    const linePointer = pointerChild(pointerChild(pointer,'LineItems'),lineIndex);
    return {pointer:linePointer, original:line,
      fields:plain(line)?fieldPointers(line,linePointer):{}};
  });
  const native = {
    collection,index,pointer,...identified,number,id,status:sourceText(original.Status),
    currency:sourceText(original.CurrencyCode),amounts,canonicalAmounts:canonical,
    providerRejected:errors.providerRejected,validationPointers:errors.pointers,
    fields:fieldPointers(original,pointer),lineItemsPresent:has(original,'LineItems'),
    lineItems,original,issues
  };
  return {native, record:{
    documentNumber:number, externalDocumentId:id, externalStatus:sourceText(original.Status),
    net:canonical.net, tax:canonical.tax, total:canonical.total,
    currency:sourceText(original.CurrencyCode),
    error:[...errors.messages,...issues].join(' '), providerRejected:errors.providerRejected,
    rowNumbers:[],sourcePointers:[pointer]
  }};
}

/**
 * Read one untouched Accounting API response/page. The caller retains returned
 * bytes in its existing immutable receiving operation; no provider call or state write occurs here.
 */
export function readNativeXeroResults(value, documents) {
  need(plain(value) && (value.format === undefined || value.format === 'NATIVE_JSON'),
    'XERO_NATIVE_FORMAT', 'Choose the original native JSON return format.');
  need(Array.isArray(documents) && documents.length > 0,
    'XERO_NATIVE_SELECTION', 'Choose the original Xero package documents.');
  const original = decodeXeroFile(value.file);
  let text;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(original.bytes); }
  catch { need(false,'XERO_NATIVE_UTF8','Save the original response as valid UTF-8 JSON.'); }
  const parsed = parseXeroNativeJson(text), envelope = parsed.value;
  need(plain(envelope), 'XERO_NATIVE_ENVELOPE',
    'Use the complete original Xero object containing Invoices, CreditNotes or validation Elements.');
  const collections = ['Invoices','CreditNotes','Elements'].filter(name=>has(envelope,name));
  need(collections.length > 0, 'XERO_NATIVE_ENVELOPE',
    'The original response has no Invoices, CreditNotes or validation Elements collection.');
  for (const name of collections)
    need(Array.isArray(envelope[name]), 'XERO_NATIVE_COLLECTION',
      'The original ' + name + ' collection must be an array.');
  const selected = new Map(documents.map(doc=>[doc.number,doc]));
  const acceptedStatuses = new Set((Array.isArray(value.importedStatusValues) ?
    value.importedStatusValues : ['DRAFT','AUTHORISED','PAID']).map(status=>sourceText(status).trim()));
  const records = [], nativeDocuments = [], excludedDocuments = [];
  for (const collection of collections) for (const [index,entry] of envelope[collection].entries()) {
    const {native,record} = documentSource(entry,collection,index,envelope,selected,acceptedStatuses);
    // An unidentified Elements object never proves a successful imported document.
    if (collection === 'Elements' && native.kindSource === 'rejected element fields' &&
        !record.providerRejected) {
      native.excludedReason = 'An untyped Elements object has no original provider validation rejection.';
    }
    nativeDocuments.push(native);
    if (native.excludedReason) excludedDocuments.push({
      pointer:native.pointer,type:native.type,number:native.number,id:native.id,reason:native.excludedReason
    });
    else records.push(record);
  }
  const envelopeFields = Object.fromEntries(Object.entries(envelope).filter(([key])=>!collections.includes(key)));
  const native = {
    schema:XERO_NATIVE_RETURN_SCHEMA,
    sourceKind:collections.includes('Elements')?'XERO_ACCOUNTING_VALIDATION_RESPONSE':'XERO_ACCOUNTING_RESPONSE',
    collections:collections.map(name=>({name,pointer:'/'+name,count:envelope[name].length})),
    envelope:envelopeFields,
    documentCount:nativeDocuments.length,consideredCount:records.length,
    excludedDocuments,documents:nativeDocuments,numericTokens:parsed.numericTokens,
    numberEncoding:'Exact original JSON number lexemes are strings; numericTokens preserves their source types.',
    monetaryConvention:{decimalSeparator:'.',groupSeparator:'',creditSign:'POSITIVE'}
  };
  const evaluated = evaluateXeroReturnRows(records,documents,{
    importedStatusValues:value.importedStatusValues,
    retiredStatusValues:value.retiredStatusValues,
    decimalSeparator:'.',groupSeparator:'',creditSign:'POSITIVE'
  });
  return {schema:XERO_RESULT_SCHEMA,format:'NATIVE_JSON',
    file:{name:original.name,bytes:original.bytes.length,sha256:original.sha256,type:'application/json'},
    bytes:original.bytes,native,...evaluated};
}
