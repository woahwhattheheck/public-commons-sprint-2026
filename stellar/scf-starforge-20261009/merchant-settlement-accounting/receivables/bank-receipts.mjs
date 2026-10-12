// MIT. Exact bank source identities and reviewed splits over original receivables.
import {randomUUID} from 'node:crypto';
import {cwDecode, cwUtf8, readCryptoworthCsv, writeCryptoworthCsv} from '../accountant/cryptoworth-csv.mjs';
import {parseOriginalBankStatement} from './bank-statement-source.mjs';
import {json, sha, need, plain, field, identifier, dateValue, currencyOf, currencyKey, minor, money,
  today, customerSnapshot, invoiceSummary, receiptSummary, receiptBalanceDates,
  assertReceiptConservation, receiptUnreconciledRefunds, allocationActive, csv} from './core.mjs';

export const BANK_SOURCE_BYTES = 1_000_000;
export const BANK_SOURCE_ROWS = 5_000;
export const BANK_DERIVED_BYTES = 16_000_000;
export const BANK_ACCOUNT_SCHEMA = 'stellar-forge.merchant-bank-account.v1';
export const BANK_IMPORT_SCHEMA = 'stellar-forge.merchant-bank-import.v1';
export const BANK_INSPECTION_SCHEMA = 'stellar-forge.merchant-bank-source-inspection.v1';
export const BANK_POSTING_SCHEMA = 'stellar-forge.merchant-bank-posting-proposal.v1';
export const BANK_FILE_NAMES = Object.freeze(['source.csv','source.ofx','source.mt940','import.json','rows.json','rows.csv','status.json','reconciliation.json','parser-report.json']);
const HEX = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const optional = (value, name, max = 200) => field(value ?? '', name, max, true);
const maxDate = (...dates) => dates.filter(Boolean).sort().at(-1);
export const bankAccountRows = data => data.bankAccounts ?? [];
export const bankImportRows = data => data.bankImports ?? [];
export function bankPage(value = {}) {
  const offset = Number(value.offset ?? 0), limit = Number(value.limit ?? 100);
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 500,
    'INVALID_BANK_PAGE', 'Use a nonnegative offset and a page size from one to 500.');
  return {offset,limit};
}
export function bankHash(value, name = 'source row') {
  need(typeof value === 'string' && HEX.test(value), 'INVALID_BANK_SOURCE_ID', 'Choose the retained ' + name + '.');
  return value;
}
function sourceError(error) {
  if (typeof error.code === 'string' && error.code.includes('CRYPTOWORTH')) {
    error.code = error.code.replaceAll('CRYPTOWORTH','BANK_SOURCE');
    error.message = error.message.replaceAll('Cryptoworth','bank source').replaceAll('cryptoworth','bank source');
  }
  throw error;
}
export function decodeBankSource(file) {
  try { return cwDecode(file,{max:BANK_SOURCE_BYTES}); } catch(error) { sourceError(error); }
}
export function normalizeBankLayout(value, headers = null) {
  need(plain(value), 'BANK_CSV_LAYOUT_REQUIRED', 'Map the original bank CSV columns and their date and amount representations.');
  const delimiter = value.delimiter, dateFormat = value.dateFormat, decimalMark = value.decimalMark ?? '.',
    groupSeparator = value.groupSeparator ?? '', amountMode = value.amountMode ?? 'SIGNED', creditSign = value.creditSign ?? 'POSITIVE';
  need([',',';','\t'].includes(delimiter), 'INVALID_BANK_DELIMITER', 'Choose the original comma, semicolon or tab delimiter.');
  need(['YYYY-MM-DD','DD/MM/YYYY','MM/DD/YYYY','YYYYMMDD'].includes(dateFormat), 'INVALID_BANK_DATE_FORMAT', 'Choose the exact source calendar date representation.');
  need(['.',','].includes(decimalMark) && ['',',','.',' '].includes(groupSeparator) && decimalMark !== groupSeparator,
    'INVALID_BANK_DECIMAL_FORMAT', 'Choose distinct original decimal and optional grouping separators.');
  need(['SIGNED','CREDIT_DEBIT'].includes(amountMode) && ['POSITIVE','NEGATIVE'].includes(creditSign),
    'INVALID_BANK_AMOUNT_MODE', 'Select signed amounts or separate credit and debit columns.');
  need(plain(value.columns), 'BANK_COLUMNS_REQUIRED', 'Bind the actual original column names.');
  const roles = ['date','amount','credit','debit','transactionId','reference','counterparty','invoiceReference','valueDate','balance'];
  const columns = {}, used = new Set();
  for (const [role,column] of Object.entries(value.columns)) {
    need(roles.includes(role) && typeof column === 'string' && column.length > 0 && column.length <= 32000 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(column) && (!headers || headers.includes(column)),
      'INVALID_BANK_COLUMN', 'Bind ' + role + ' to an exact original header.');
    need(!used.has(column), 'BANK_COLUMN_REUSED', 'Assign each original column to one role.');
    columns[role] = column; used.add(column);
  }
  need(columns.date && (amountMode === 'SIGNED' ? columns.amount && !columns.credit && !columns.debit :
    columns.credit && columns.debit && !columns.amount), 'BANK_COLUMNS_REQUIRED', 'Map the date and every column required by the selected amount representation.');
  return {delimiter,dateFormat,decimalMark,groupSeparator,amountMode,creditSign,columns};
}
export function normalizeBankAccount(value, existing = null) {
  need(plain(value),'INVALID_BANK_ACCOUNT','Enter the original account identity and its explicit currency.');
  const currency = currencyOf(value.currency), status = value.status ?? existing?.status ?? 'ACTIVE';
  need(['ACTIVE','ARCHIVED'].includes(status),'INVALID_BANK_ACCOUNT_STATUS','Use ACTIVE or ARCHIVED.');
  return {schema:BANK_ACCOUNT_SCHEMA,id:existing?.id ?? (value.id ? identifier(value.id,'bank account') : randomUUID()),
    reference:field(value.reference,'bank account reference',80),name:field(value.name,'bank account name',200),
    currency,method:field(value.method ?? 'Bank transfer','payment method',100),
    bankId:optional(value.bankId,'bank identifier'),accountReference:optional(value.accountReference,'original bank account reference'),
    csvLayout:value.csvLayout == null ? null : normalizeBankLayout(value.csvLayout),status,
    version:existing ? existing.version + 1 : 1};
}
export function bankAccountSummary(account) {
  return clone(Object.fromEntries(['id','reference','name','currency','method','bankId','accountReference','csvLayout',
    'status','version','createdAt','updatedAt'].map(key=>[key,account[key] ?? null])));
}
function calendar(value, format, label) {
  const text = String(value ?? '').trim(); let normalized;
  if (format === 'YYYY-MM-DD') normalized = text;
  else if (format === 'YYYYMMDD' && /^\d{8}$/.test(text)) normalized = text.slice(0,4)+'-'+text.slice(4,6)+'-'+text.slice(6,8);
  else if (['DD/MM/YYYY','MM/DD/YYYY'].includes(format) && /^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [one,two,year] = text.split('/'); normalized = year+'-'+(format === 'DD/MM/YYYY' ? two : one)+'-'+(format === 'DD/MM/YYYY' ? one : two);
  }
  need(normalized, 'INVALID_BANK_DATE', 'The original ' + label + ' differs from the selected date representation.');
  return dateValue(normalized,label);
}
function decimal(value, layout, currency, {blank = false, signed = true} = {}) {
  let text = String(value ?? '').trim();
  if (!text && blank) return money(0n,currency);
  need(text.length > 0 && text.length <= 100, 'INVALID_BANK_AMOUNT', 'Choose the exact original decimal amount.');
  let negative = false;
  if (text.startsWith('-') || text.startsWith('+')) { negative=text.startsWith('-');text=text.slice(1); }
  need(!negative || signed,'INVALID_BANK_AMOUNT_SIGN','The credit and debit columns must contain unsigned quantities.');
  const pieces = text.split(layout.decimalMark);
  need(pieces.length <= 2 && pieces[0].length > 0 && (pieces.length === 1 || /^\d+$/.test(pieces[1])),
    'INVALID_BANK_AMOUNT','The original amount differs from the selected decimal representation.');
  let whole=pieces[0],fraction=pieces[1]??'';
  if (layout.groupSeparator && whole.includes(layout.groupSeparator)) {
    const groups=whole.split(layout.groupSeparator);
    need(/^\d{1,3}$/.test(groups[0])&&groups.slice(1).every(part=>/^\d{3}$/.test(part)),
      'INVALID_BANK_AMOUNT_GROUPING','The original amount has invalid digit grouping.');
    whole=groups.join('');
  }
  need(/^\d+$/.test(whole) && fraction.slice(currency.scale).split('').every(char=>char==='0'),
    'INVALID_BANK_AMOUNT_PRECISION','The source amount cannot be represented exactly in this account currency.');
  whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.slice(0,currency.scale);
  return money(minor((negative?'-':'')+whole+(fraction?'.'+fraction:''),currency,'bank amount',{signed}),currency);
}
function contentText(value, limit = 32000) {
  const text=String(value ?? '');
  need(text.length<=limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text),
    'INVALID_BANK_SOURCE_TEXT','An original source field exceeds the supported limit or contains control characters.');
  return text;
}
function csvSource(bytes, account, layoutValue) {
  let parsed;
  try { parsed=readCryptoworthCsv(bytes,{delimiter:layoutValue?.delimiter}); } catch(error) { sourceError(error); }
  need(parsed.records.length<=BANK_SOURCE_ROWS,'BANK_SOURCE_ROW_LIMIT','Import at most 5,000 original statement rows.');
  need(parsed.records.every(row=>row.values.length===parsed.headers.length),'BANK_SOURCE_ROW_WIDTH',
    'An original CSV row has a different column count from its retained header.');
  const mode=layoutValue?.amountMode??'SIGNED',mapped=plain(layoutValue?.columns)&&layoutValue.columns.date&&
    (mode==='SIGNED'?layoutValue.columns.amount:layoutValue.columns.credit&&layoutValue.columns.debit)&&layoutValue?.dateFormat;
  const layout=mapped?normalizeBankLayout(layoutValue,parsed.headers):null;
  const sectionId=sha(json({format:'CSV',columns:parsed.headers}));
  const rows=parsed.records.map(row=>{
    const raw={values:clone(row.values),fields:{},text:null};
    if(!layout || !account) return {rowNumber:row.rowNumber,lineNumber:row.lineNumber,raw};
    const get=role=>layout.columns[role] ? row.values[parsed.headers.indexOf(layout.columns[role])] : '';
    let amount;
    if(layout.amountMode==='SIGNED') {
      amount=decimal(get('amount'),layout,account.currency);
      if(layout.creditSign==='NEGATIVE') amount=money(-minor(amount,account.currency,'bank amount',{signed:true}),account.currency);
    } else {
      const credit=minor(decimal(get('credit'),layout,account.currency,{blank:true,signed:false}),account.currency),
        debit=minor(decimal(get('debit'),layout,account.currency,{blank:true,signed:false}),account.currency);
      need(!(credit>0n&&debit>0n),'BANK_AMBIGUOUS_CREDIT_DEBIT','A row contains both a credit and a debit; retain one actual source transaction per row.');
      amount=money(credit-debit,account.currency);
    }
    return {rowNumber:row.rowNumber,lineNumber:row.lineNumber,raw,
      bookedDate:calendar(get('date'),layout.dateFormat,'booked date'),
      valueDate:get('valueDate').trim()?calendar(get('valueDate'),layout.dateFormat,'value date'):null,
      amount,currency:clone(account.currency),transactionId:get('transactionId').trim()||null,bankReference:'',
      reference:contentText(get('reference')),counterparty:contentText(get('counterparty')),invoiceReference:contentText(get('invoiceReference')),
      balance:get('balance').trim()?decimal(get('balance'),layout,account.currency):null};
  });
  return {layout:layout??(layoutValue?clone(layoutValue):null),columns:parsed.headers,sections:[{id:sectionId,kind:'CSV',bankId:null,accountReference:null,
    currencyCode:account?.currency.code??null,from:null,until:null,openingBalance:null,closingBalance:null,rows}],
    requiresLayout:!layout,newline:parsed.newline,bom:parsed.bom};
}
function sectionSummary(section) {
  const values=section.rows.filter(row=>typeof row.amount==='string'),positive=row=>!row.amount.startsWith('-')&&!/^0(?:\.0+)?$/.test(row.amount);
  return {id:section.id,kind:section.kind,bankId:section.bankId??null,accountReference:section.accountReference??null,
    currencyCode:section.currencyCode??null,sourceAccountIdentity:clone(section.sourceAccountIdentity??{}),
    balanceSnapshots:clone(section.balanceSnapshots??[]),from:section.from??null,until:section.until??null,
    openingBalance:section.openingBalance??null,closingBalance:section.closingBalance??null,rowCount:section.rows.length,
    creditCount:values.filter(positive).length,debitCount:values.filter(row=>row.amount.startsWith('-')).length,
    zeroCount:values.filter(row=>/^0(?:\.0+)?$/.test(row.amount)).length};
}
function normalizedRow(source,section,row,index,account) {
  const amount=money(minor(row.amount,account.currency,'bank transaction',{signed:true}),account.currency);
  const raw=clone(row.raw),sourceRowSha256=sha(json({sectionId:section.id,rowNumber:row.rowNumber??index+1,raw}));
  const units=minor(amount,account.currency,'bank transaction',{signed:true});
  const transactionId=row.transactionId==null?null:contentText(row.transactionId,1000).trim()||null;
  const result={id:sha(json({sourceSha256:source.sha256,sectionId:section.id,index,sourceRowSha256})),
    rowNumber:row.rowNumber??index+1,lineNumber:row.lineNumber??null,sourceRowSha256,raw,
    bookedDate:dateValue(row.bookedDate,'bank booked date'),valueDate:row.valueDate?dateValue(row.valueDate,'bank value date'):null,
    amount,currency:clone(account.currency),transactionId,bankReference:contentText(row.bankReference??'',1000),
    reference:contentText(row.reference),counterparty:contentText(row.counterparty),invoiceReference:contentText(row.invoiceReference),
    balance:row.balance==null?null:money(minor(row.balance,account.currency,'source balance',{signed:true}),account.currency),
    kind:units>0n?'CREDIT':units<0n?'DEBIT':'ZERO',cashSource:section.kind!=='CREDIT_CARD',
    dateBasis:row.dateBasis??'CSV_MAPPED_DATE',narrative:contentText(row.narrative??''),
    sourceEligible:row.sourceEligible!==false,requiresSourceResolution:row.requiresSourceResolution===true,
    sourceIssues:clone(row.sourceIssues??[]),sourceIdentity:clone(row.sourceIdentity??null),
    originalDates:clone(row.originalDates??null),originalEntryMonthDay:row.originalEntryMonthDay??null,
    sourcePageSha256:row.sourcePageSha256??null,originalSourceOccurrences:clone(row.originalSourceOccurrences??[])};
  result.replacesTransactionKeys=(row.replacesTransactionIds??[]).map(transactionId=>sha(json({accountId:account.id,transactionId})));
  result.transactionKey=transactionId ? sha(json({accountId:account.id,transactionId})) :
    row.sourceIdentityKey?sha(json({accountId:account.id,sourceIdentityKey:row.sourceIdentityKey})):null;
  result.transactionIdentity=transactionId?'BANK_TRANSACTION_ID':row.sourceIdentityKey?'STATEMENT_POSITION':'NONE';
  result.economicKey=sha(json({accountId:account.id,date:result.bookedDate,amount,currency:result.currency,
    reference:result.reference.trim(),counterparty:result.counterparty.trim(),invoiceReference:result.invoiceReference.trim()}));
  return result;
}
export async function inspectBankInput(value, account = null) {
  need(plain(value)&&['CSV','OFX','MT940'].includes(value.format),'INVALID_BANK_SOURCE_FORMAT','Choose CSV, OFX or MT940.');
  const decoded=decodeBankSource(value.file),source={name:decoded.name,format:value.format,bytes:decoded.bytes.length,sha256:decoded.sha256};
  let parsed;
  if(value.format==='CSV') {
    need(value.statementOptions==null,'BANK_STATEMENT_OPTIONS_NOT_APPLICABLE','Statement transport options apply only to MT940.');
    parsed=csvSource(decoded.bytes,account,value.csvLayout??account?.csvLayout);
  }
  else {
    need(value.csvLayout==null,'BANK_LAYOUT_NOT_APPLICABLE','CSV layouts apply only to the original CSV source.');
    parsed=await parseOriginalBankStatement(decoded.bytes,value.format,{account,statementOptions:value.statementOptions});
    parsed.layout=null;parsed.columns=[];parsed.requiresLayout=false;
  }
  need(parsed.sections.length>0 && parsed.sections.length<=100,'BANK_STATEMENT_SECTION_LIMIT','Choose a statement containing one to100 original account sections.');
  need(parsed.sections.reduce((total,section)=>total+section.rows.length,0)<=BANK_SOURCE_ROWS,
    'BANK_SOURCE_ROW_LIMIT','Import at most5,000 original statement rows across its account sections.');
  const chosen=value.sectionId ? parsed.sections.find(section=>section.id===bankHash(value.sectionId,'statement section')) :
    parsed.sections.length===1 ? parsed.sections[0] : null;
  need(!value.sectionId||chosen,'BANK_SECTION_NOT_FOUND','Choose an original account section from this source.',404);
  const issues=[];
  if(account&&chosen) {
    if(chosen.currencyCode && chosen.currencyCode!==account.currency.code) issues.push({code:'BANK_CURRENCY_MISMATCH',message:'The original statement currency differs from the selected account.'});
    if(chosen.accountReference && chosen.accountReference!==account.accountReference) issues.push({code:'BANK_ACCOUNT_MISMATCH',message:'The original statement account reference differs from the selected account identity.'});
    if(chosen.bankId && chosen.bankId!==account.bankId) issues.push({code:'BANK_ID_MISMATCH',message:'The original statement bank identifier differs from the selected account identity.'});
  }
  const ready=Boolean(account&&chosen&&!parsed.requiresLayout&&issues.length===0);
  issues.push(...(parsed.issues??[]));
  const rows=chosen ? chosen.rows.map((row,index)=>{
    if(!ready) return clone(row);
    if(value.format==='CSV') return normalizedRow(source,chosen,row,index,account);
    const layout={decimalMark:'.',groupSeparator:''};
    const normalized={...row,amount:decimal(row.amount,layout,account.currency),
      balance:row.balance==null?null:decimal(row.balance,layout,account.currency)};
    return normalizedRow(source,chosen,normalized,index,account);
  }) : [];
  const view={schema:BANK_INSPECTION_SCHEMA,source,accountId:account?.id??null,layout:parsed.layout,
    columns:clone(parsed.columns),sections:parsed.sections.map(sectionSummary),sectionId:chosen?.id??null,
    requiresLayout:parsed.requiresLayout,statementOptions:parsed.statementOptions??null,rows:{total:rows.length,items:rows.slice(0,50)},issues};
  return {view,source,bytes:decoded.bytes,rows,section:chosen?sectionSummary(chosen):null,
    columns:clone(parsed.columns),layout:parsed.layout,statementOptions:parsed.statementOptions??null,
    parserReport:parsed.parserReport??null,ready,sections:view.sections};
}
export function normalizedBankSourceFiles(compiled) {
  const body={schema:'stellar-forge.merchant-bank-source-rows.v1',source:compiled.source,section:compiled.section,
    layout:compiled.layout,columns:compiled.columns,rows:compiled.rows};
  return [{name:'source.'+compiled.source.format.toLowerCase(),bytes:compiled.bytes,type:compiled.source.format==='CSV'?'text/csv; charset=utf-8':'application/octet-stream'},
    {name:'rows.json',bytes:Buffer.from(json(body)),type:'application/json; charset=utf-8'},
    {name:'rows.csv',bytes:Buffer.from(csv([['row_id','source_row','booked_date','value_date','currency','amount','transaction_id','bank_reference','reference','counterparty','invoice_reference','kind'],
      ...compiled.rows.map(row=>[row.id,row.rowNumber,row.bookedDate,row.valueDate,row.currency.code,row.amount,row.transactionId,row.bankReference,row.reference,row.counterparty,row.invoiceReference,row.kind])])),
      type:'text/csv; charset=utf-8'}];
}

export function bankRowDecision(bankImport,rowId) { return (bankImport.decisions??[]).find(row=>row.rowId===rowId)??null; }
function sourceIds(row) { return [...new Set([row.transactionKey,...(row.replacesTransactionKeys??[])].filter(Boolean))]; }
function bankCoverageKey(link) {
  return link.coverageKey??sha(json({bankAccountId:link.bankAccountId,
    transactionKey:link.transactionKey??null,economicKey:link.transactionKey?null:link.economicKey,
    distinctPaymentId:link.distinctPaymentId??null}));
}
function receiptCoverageGroups(receipt) {
  const groups=new Map();
  for(const link of receipt.bankSources??[]) {
    const key=bankCoverageKey(link),amount=minor(link.splitAmount,receipt.currency,'original source coverage',{positive:true});
    if(!groups.has(key))groups.set(key,{key,amount,links:[]});
    const group=groups.get(key);
    need(group.amount===amount,'BANK_SOURCE_COVERAGE_CONFLICT',
      'The original receipt retains different covered amounts for one bank payment; correct its retained assignment.',409);
    group.links.push(link);
  }
  const total=[...groups.values()].reduce((sum,row)=>sum+row.amount,0n);
  need(total<=minor(receipt.amount,receipt.currency),'BANK_SOURCE_COVERAGE_EXCEEDED',
    'Retained distinct bank payments exceed the original receipt amount.',409);
  return {groups,total};
}
function coverageLinksMatch(link,bankImport,row,matches=[],distinctPaymentReason='') {
  if(link.bankAccountId!==bankImport.accountId)return false;
  if(link.bankImportId===bankImport.id&&link.rowId===row.id)return true;
  const keys=new Set(sourceIds(row));
  if(link.transactionKey&&keys.has(link.transactionKey))return true;
  if((link.transactionAliases??[]).some(key=>keys.has(key)))return true;
  return matches.some(match=>match.bankImportId===link.bankImportId&&match.rowId===link.rowId&&
    (match.match==='TRANSACTION_ID'||!distinctPaymentReason));
}
function currentReceiptRows(data,id,bankImport=null,sourceRow=null) {
  const found=[],seen=new Set(),queue=[id];
  while(queue.length) {
    const next=queue.shift();
    need(!seen.has(next),'BANK_RECEIPT_HISTORY_INVALID','The original receipt replacement history contains a cycle.',409);
    seen.add(next);
    const row=data.receipts.find(item=>item.id===next);if(!row)continue;
    const successors=[...new Set([...(row.replacementReceiptIds??[]),row.replacedByReceiptId].filter(Boolean))];
    if(successors.length)queue.push(...successors);else found.push(row);
  }
  if(!bankImport||!sourceRow||found.length<=1)return found;
  const keys=new Set(sourceIds(sourceRow));
  return found.filter(receipt=>(receipt.bankSources??[]).some(link=>
    link.bankAccountId===bankImport.accountId&&(
      link.bankImportId===bankImport.id&&link.rowId===sourceRow.id||
      link.transactionKey&&keys.has(link.transactionKey)||
      (link.transactionAliases??[]).some(key=>keys.has(key))||
      !sourceRow.transactionKey&&link.economicKey===sourceRow.economicKey)));
}
function sourceCoverageReview(receipt,bankImport,row,matches,amount,distinctPaymentReason,plannedLinks,requestedKey=null) {
  const original={...receipt,bankSources:plannedLinks},covered=receiptCoverageGroups(original);
  let related=[...covered.groups.values()].filter(group=>group.links.some(link=>
    coverageLinksMatch(link,bankImport,row,matches,distinctPaymentReason)));
  if(requestedKey) {
    bankHash(requestedKey,'original coverage key');
    related=related.filter(group=>group.key===requestedKey);
    need(related.length===1,'BANK_SOURCE_COVERAGE_NOT_FOUND','Choose an original covered payment for this retained source.',409);
  }
  need(related.length<=1,'BANK_SOURCE_COVERAGE_AMBIGUOUS',
    'Several original payments share these source fields; choose the exact retained coverage key for this source link.',409);
  const units=minor(amount,receipt.currency),prior=related[0],key=prior?.key??bankCoverageKey({
    bankAccountId:bankImport.accountId,transactionKey:row.transactionKey,economicKey:row.economicKey,
    distinctPaymentId:distinctPaymentReason?row.id:null});
  if(prior)need(prior.amount===units,'BANK_SOURCE_COVERAGE_CHANGED',
    'A repeated source link must retain its original covered amount; use the reviewed correction for changed bank facts.',409);
  const added=prior?0n:units,after=covered.total+added;
  need(after<=minor(receipt.amount,receipt.currency),'BANK_RECEIPT_COVERAGE_EXCEEDED',
    'Distinct original bank credits exceed the remaining unmatched amount of this receipt.',409);
  return {key,repeatedSource:Boolean(prior),receiptAmount:receipt.amount,
    beforeMatchedAmount:money(covered.total,receipt.currency),coveredByThisSource:amount,
    newlyMatchedAmount:money(added,receipt.currency),afterMatchedAmount:money(after,receipt.currency),
    remainingUnmatchedAmount:money(minor(receipt.amount,receipt.currency)-after,receipt.currency)};
}
function plannedBankLink(bankImport,row,split,postingId,distinctPaymentReason='') {
  return {bankImportId:bankImport.id,bankAccountId:bankImport.accountId,rowId:row.id,postingId,
    sourceSha256:bankImport.source.sha256,sourceRowSha256:row.sourceRowSha256,
    transactionKey:row.transactionKey,transactionAliases:[...new Set([...sourceIds(row),...(split.sourceCoverage.transactionKeys??[])])],transactionIdentity:row.transactionIdentity,
    economicKey:row.economicKey,bookedDate:row.bookedDate,sourceAmount:row.amount,
    sourceName:bankImport.source.name,transactionId:row.transactionId,bankReference:row.bankReference,reference:row.reference,
    coverageKey:split.sourceCoverage.key,distinctPaymentId:distinctPaymentReason?row.id:null,
    splitAmount:split.amount,dateDifferenceReason:split.dateDifferenceReason||null};
}
export function bankCurrentReceipts(data,id,bankImport=null,row=null) {return currentReceiptRows(data,id,bankImport,row);}
export function bankMatchIndex(data) {
  const result={transactions:new Map(),economics:new Map()};
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
  for(const bankImport of bankImportRows(data))for(const row of bankImport.index) {
    for(const key of sourceIds(row))add(result.transactions,bankImport.accountId+':'+key,{bankImport,row});
    add(result.economics,bankImport.accountId+':'+row.economicKey,{bankImport,row});
  }
  return result;
}
export function bankSourceMatches(data,bankImport,row,index=null) {
  const lookup=index??bankMatchIndex(data),candidates=new Map(),keys=new Set(sourceIds(row));
  for(const key of keys)for(const item of lookup.transactions.get(bankImport.accountId+':'+key)??[])
    candidates.set(item.bankImport.id+':'+item.row.id,{...item,exact:true});
  for(const item of lookup.economics.get(bankImport.accountId+':'+row.economicKey)??[])
    if(!candidates.has(item.bankImport.id+':'+item.row.id)&&!(row.transactionIdentity==='BANK_TRANSACTION_ID'&&item.row.transactionIdentity==='BANK_TRANSACTION_ID'))
      candidates.set(item.bankImport.id+':'+item.row.id,{...item,exact:false});
  const matches=[];
  for(const {bankImport:other,row:candidate,exact} of candidates.values()) {
    if(other.id===bankImport.id&&candidate.id===row.id)continue;
    const decision=bankRowDecision(other,candidate.id),receiptIds=[...new Set((decision?.receiptIds??[]).flatMap(id=>currentReceiptRows(data,id,other,candidate).map(row=>row.id)))];
    matches.push({bankImportId:other.id,sourceName:other.source.name,rowId:candidate.id,match:exact?'TRANSACTION_ID':'SAME_PAYMENT_FIELDS',
      amount:candidate.amount,bookedDate:candidate.bookedDate,kind:candidate.kind,
      sameFacts:candidate.amount===row.amount&&candidate.bookedDate===row.bookedDate,
      status:decision?.status??'UNASSIGNED',receiptIds,
      replacesTransactionKeys:clone(candidate.replacesTransactionKeys??[]),sourceIdentity:clone(candidate.sourceIdentity??null)});
  }
  return matches;
}
export function bankRowStatus(data,bankImport,row,index=null) {
  const decision=bankRowDecision(bankImport,row.id);
  if(decision) return decision.status;
  if(row.kind!=='CREDIT'||row.cashSource===false||row.sourceEligible===false) return 'SOURCE_ONLY';
  const matches=bankSourceMatches(data,bankImport,row,index);
  if(row.requiresSourceResolution)return 'CONFLICT';
  if(matches.some(item=>item.match==='TRANSACTION_ID'&&!item.sameFacts&&item.status!=='IGNORED')) return 'CONFLICT';
  if(matches.some(item=>item.receiptIds.length>0)) return 'DUPLICATE';
  return 'UNASSIGNED';
}
export function bankImportSummary(bankImport,data,index=null) {
  const lookup=index??bankMatchIndex(data);
  const counts={UNASSIGNED:0,POSTED:0,LINKED:0,IGNORED:0,DUPLICATE:0,CONFLICT:0,SOURCE_ONLY:0};
  for(const row of bankImport.index) counts[bankRowStatus(data,bankImport,row,lookup)]++;
  return {id:bankImport.id,accountId:bankImport.accountId,accountReference:bankImport.account.reference,
    accountName:bankImport.account.name,sourceName:bankImport.source.name,format:bankImport.source.format,
    sourceSha256:bankImport.source.sha256,sectionId:bankImport.section.id,currency:clone(bankImport.account.currency),
    status:bankImport.status,rowCount:bankImport.index.length,creditCount:bankImport.index.filter(row=>row.kind==='CREDIT').length,
    debitCount:bankImport.index.filter(row=>row.kind==='DEBIT').length,zeroCount:bankImport.index.filter(row=>row.kind==='ZERO').length,
    unassignedCount:counts.UNASSIGNED,postedCount:counts.POSTED,linkedCount:counts.LINKED,ignoredCount:counts.IGNORED,
    duplicateCount:counts.DUPLICATE,conflictCount:counts.CONFLICT,sourceOnlyCount:counts.SOURCE_ONLY,
    postingCount:bankImport.postings.length,createdAt:bankImport.createdAt,closedAt:bankImport.closedAt??null};
}
const includesReference = (haystack,value) => value && haystack.includes(value.toLocaleLowerCase());
export function bankRowView(data,bankImport,row,customers,asOf=today(),index=null) {
  const matches=bankSourceMatches(data,bankImport,row,index),status=bankRowStatus(data,bankImport,row,index),
    decision=bankRowDecision(bankImport,row.id);
  const text=[row.reference,row.invoiceReference,row.counterparty,row.bankReference,row.narrative].join('\n').toLocaleLowerCase();
  const byReceipt=new Map(),byInvoice=new Map(),byCustomer=new Map();
  const addCustomer=(customer,reason)=>{
    if(!customer)return;
    if(!byCustomer.has(customer.id))byCustomer.set(customer.id,{customer:customerSnapshot(customer),reasons:[]});
    const reasons=byCustomer.get(customer.id).reasons;if(!reasons.includes(reason))reasons.push(reason);
  };
  for(const customer of customers) if(includesReference(text,customer.reference)||
    (row.counterparty.trim()&&row.counterparty.trim().toLocaleLowerCase()===customer.name?.trim().toLocaleLowerCase()))
    addCustomer(customer,'Original customer reference or exact counterparty name');
  for(const invoice of data.invoices) if(invoice.document&&currencyKey(invoice.document.currency)===currencyKey(row.currency)&&
    includesReference(text,invoice.number)) {
    const summary=invoiceSummary(invoice,data,asOf);
    byInvoice.set(invoice.id,{invoice:summary,reasons:['Original invoice number in source remittance']});
    addCustomer(customers.find(customer=>customer.id===summary.customerId),'Original remittance invoice customer');
  }
  const linkedIds=new Set(matches.flatMap(item=>item.receiptIds));
  for(const id of decision?.receiptIds??[])for(const receipt of currentReceiptRows(data,id,bankImport,row))linkedIds.add(receipt.id);
  for(const receipt of data.receipts) {
    if(currencyKey(receipt.currency)!==currencyKey(row.currency))continue;
    const reasons=[];
    if(linkedIds.has(receipt.id))reasons.push('Original receipt already bound to this source payment');
    if(receipt.status==='RECORDED'&&receipt.amount===row.amount&&receipt.receivedDate===row.bookedDate)
      reasons.push('Exact original amount and received date');
    if(receipt.status==='RECORDED'&&includesReference(text,receipt.reference))reasons.push('Original payment reference in source remittance');
    if(!reasons.length)continue;
    byReceipt.set(receipt.id,{receipt:receiptSummary(receipt,data,asOf),reasons});
    addCustomer(customers.find(customer=>customer.id===receipt.customerId),'Original matching receipt customer');
  }
  const supersededBy=matches.filter(item=>item.sourceIdentity?.correctionAction==='REPLACE'&&
    item.replacesTransactionKeys.includes(row.transactionKey)&&['POSTED','LINKED'].includes(item.status));
  return {...clone(row),status,supersededBy,canPost:!supersededBy.length&&row.kind==='CREDIT'&&row.cashSource!==false&&row.sourceEligible!==false&&bankImport.status==='OPEN'&&status!=='IGNORED',
    decision:clone(decision),sourceMatches:matches,receiptCandidates:[...byReceipt.values()].slice(0,50),
    invoiceCandidates:[...byInvoice.values()].slice(0,50),customerCandidates:[...byCustomer.values()].slice(0,50)};
}
function invoiceDates(data,invoice,from) {
  const dates=new Set([from,invoice.document.issueDate]);
  if(invoice.voidDate)dates.add(invoice.voidDate);
  for(const row of data.allocations)if(row.invoiceId===invoice.id){dates.add(row.allocatedDate);if(row.releasedDate)dates.add(row.releasedDate);}
  for(const row of data.credits)if(row.invoiceId===invoice.id)dates.add(row.document.creditDate);
  return [...dates].filter(value=>value>=from).sort();
}
export function assertBankInvoiceConservation(data,invoice) {
  if(!invoice.document)return;
  for(const date of invoiceDates(data,invoice,invoice.document.issueDate)) {
    let allocated=0n;
    for(const row of data.allocations)if(row.invoiceId===invoice.id&&allocationActive(row,date))allocated+=minor(row.amount,invoice.document.currency);
    const capacity=invoice.document.issueDate<=date&&(!invoice.voidDate||invoice.voidDate>date)?minor(invoice.document.totals.total,invoice.document.currency):0n;
    need(allocated<=capacity,'BANK_INVOICE_ALREADY_ALLOCATED',
      'The reviewed bank posting exceeds original invoice capacity during a saved payment interval.',409);
  }
}
function receiptBinding(receipt) {
  return {id:receipt.id,sha256:sha(json(receipt)),customerId:receipt.customerId,currency:clone(receipt.currency),
    amount:receipt.amount,receivedDate:receipt.receivedDate,accountingDate:receipt.accountingDate??receipt.receivedDate,
    status:receipt.status,voidDate:receipt.voidDate??null,sourceKey:receipt.sourceKey??null,reference:receipt.reference,method:receipt.method};
}
function invoiceBinding(invoice) { return {id:invoice.id,version:invoice.version,sha256:sha(json(invoice)),number:invoice.number}; }
function normalizeAllocations(data,customerId,currency,input,receiptId,accountingDate,ids) {
  const selected=input??[];
  need(Array.isArray(selected)&&selected.length<=100,'BANK_ALLOCATION_LIMIT','Use at most100 explicit invoice allocations per customer split.');
  const used=new Set();
  return selected.map((value,index)=>{
    need(plain(value),'INVALID_BANK_ALLOCATION','Choose an original invoice and exact amount.');
    const invoice=data.invoices.find(row=>row.id===identifier(value.invoiceId,'invoice'));
    need(invoice?.document&&invoice.status==='ISSUED'&&invoice.draft.customerId===customerId&&
      currencyKey(invoice.document.currency)===currencyKey(currency),'BANK_INVOICE_MISMATCH',
      'Select an issued invoice for this split’s original customer and currency.',409);
    need(!used.has(invoice.id),'BANK_INVOICE_REPEATED','Combine repeated allocations to the same invoice in one split.');used.add(invoice.id);
    const amount=money(minor(value.amount,currency,'invoice allocation',{positive:true}),currency),
      allocatedDate=dateValue(value.allocatedDate??accountingDate,'allocation date');
    need(allocatedDate>=accountingDate&&allocatedDate>=invoice.document.issueDate,'BANK_ALLOCATION_BEFORE_CASH',
      'Allocate on or after the invoice date and the receipt accounting date.');
    return {id:ids?.[index]??randomUUID(),receiptId,invoiceId:invoice.id,invoiceNumber:invoice.number,
      invoice:invoiceBinding(invoice),amount,allocatedDate};
  });
}
function releaseForCorrection(data,receipt,effectiveDate,reason) {
  need(receipt.status==='RECORDED'&&['OPERATOR_RECORDED','ORIGINAL_BANK_RECEIPT'].includes(receipt.source?.kind),
    'BANK_RECEIPT_CORRECTION_SCOPE','Correct an original operator receipt or bank-source receipt.',409);
  need(effectiveDate>=(receipt.accountingDate??receipt.receivedDate),'BANK_CORRECTION_BEFORE_RECEIPT',
    'The correction date must be on or after the original receipt accounting date.');
  need(receiptUnreconciledRefunds(receipt,data,'9999-12-31').length===0,'UNRECONCILED_REFUND_RETURN',
    'Reconcile the original verified outgoing payment before correcting this receipt.',409);
  return data.allocations.filter(row=>row.receiptId===receipt.id&&(!row.releasedDate||row.releasedDate>effectiveDate)).map(row=>
    ({id:row.id,invoiceId:row.invoiceId,amount:row.amount,allocatedDate:row.allocatedDate,
      previousReleasedDate:row.releasedDate??null,releasedDate:maxDate(effectiveDate,row.allocatedDate),
      originalSha256:sha(json(row)),reason}));
}
function nativeReceiptSource(bankImport,row,postingId,splitId) {
  return {kind:'ORIGINAL_BANK_RECEIPT',bankImportId:bankImport.id,bankAccountId:bankImport.accountId,
    sourceSha256:bankImport.source.sha256,sourceName:bankImport.source.name,format:bankImport.source.format,
    sectionId:bankImport.section.id,rowId:row.id,sourceRowSha256:row.sourceRowSha256,transactionKey:row.transactionKey,
    economicKey:row.economicKey,transactionId:row.transactionId,bankReference:row.bankReference,
    bookedDate:row.bookedDate,valueDate:row.valueDate,postingId,splitId};
}
function validateBankReplacement(data,bankImport,row,rows) {
  if(row.sourceIdentity?.correctionAction!=='REPLACE')return;
  const target=row.replacesTransactionKeys?.[0];
  need(target&&target!==row.transactionKey,'BANK_CORRECTION_TARGET_INVALID','Choose a non-cyclic original OFX replacement target.',409);
  const originals=bankImportRows(data).filter(item=>item.accountId===bankImport.accountId)
    .flatMap(item=>item.index.map(candidate=>({bankImport:item,row:candidate})));
  const targetRows=originals.filter(item=>item.row.transactionKey===target&&
    item.row.sourceIdentity?.accountKey===row.sourceIdentity.accountKey&&
    item.row.sourceIdentity?.currency===row.sourceIdentity.currency);
  need(row.sourceIdentity.targetPresentInSource||targetRows.length,'BANK_CORRECTION_TARGET_REQUIRED',
    'Retain the original OFX target source before assigning its replacement receipt.',409);
  const replacements=originals.filter(item=>item.row.transactionKey!==row.transactionKey&&
    item.row.sourceIdentity?.correctionAction==='REPLACE'&&(item.row.replacesTransactionKeys??[]).includes(target)&&
    bankRowDecision(item.bankImport,item.row.id)?.status!=='IGNORED');
  need(!replacements.length,'BANK_CORRECTION_TARGET_ALREADY_REPLACED',
    'This original OFX target has another retained replacement; resolve that original source decision before applying a different branch.',409);
  const edges=new Map();
  for(const item of [...originals,{bankImport,row}])if(item.row.sourceIdentity?.correctionAction==='REPLACE'&&
    bankRowDecision(item.bankImport,item.row.id)?.status!=='IGNORED') {
    if(!edges.has(item.row.transactionKey))edges.set(item.row.transactionKey,new Set());
    for(const key of item.row.replacesTransactionKeys??[])edges.get(item.row.transactionKey).add(key);
  }
  const visit=(key,path=new Set())=>{
    need(!path.has(key),'BANK_CORRECTION_SOURCE_CYCLE','The retained original OFX replacement chain contains a cycle.',409);
    const next=new Set(path);next.add(key);
    for(const target of edges.get(key)??[])visit(target,next);
  };
  visit(row.transactionKey);
}
function moneyProjection(summary) {
  if(!summary)return null;
  return Object.fromEntries(['id','customerId','reference','number','currency','amount','receivedDate','accountingDate','voidDate',
    'allocated','available','reserved','refunded','netAmount','unreconciledRefundAmount','refundDeficit',
    'paid','credited','amountDue','creditBalance','paymentStatus'].filter(key=>summary[key]!==undefined).map(key=>[key,clone(summary[key])]));
}
export function applyBankPostingChanges(data,proposal,actor,recordedAt) {
  const result=clone(data),receiptIds=[],invoiceIds=new Set(),allocationIds=[],corrected=new Set(),
    selections=proposal.selections.flatMap(selection=>selection.splits.map(split=>({selection,split})));
  // Release an original aggregate once. Every explicit successor starts at the same reviewed boundary.
  for(const {split}of selections)if(split.action==='CORRECT'&&!corrected.has(split.originalReceipt.id)) {
    corrected.add(split.originalReceipt.id);
    const old=result.receipts.find(row=>row.id===split.originalReceipt.id);
    for(const release of split.releasedAllocations) {
      const allocation=result.allocations.find(row=>row.id===release.id);
      allocation.releasedDate=release.releasedDate;allocation.releasedBy=actor;allocation.reason=split.reason;
      allocation.history.push({at:recordedAt,actor,action:'bank_receipt_correction_release',releasedDate:release.releasedDate,
        previousReleasedDate:release.previousReleasedDate,reason:split.reason,bankPostingId:proposal.id});
      invoiceIds.add(allocation.invoiceId);
    }
    old.status='VOID';old.voidDate=split.effectiveDate;old.replacementReceiptIds=clone(split.replacementReceiptIds);
    old.replacedByReceiptId=split.replacementReceiptIds.length===1?split.replacementReceiptIds[0]:null;
    old.history.push({at:recordedAt,actor,action:'bank_receipt_corrected',voidDate:old.voidDate,
      replacementReceiptIds:clone(split.replacementReceiptIds),bankPostingId:proposal.id,reason:split.reason});
    receiptIds.push(old.id);
    if(split.residualReceipt) {
      const retained=split.residualReceipt,residual={id:retained.id,customerId:retained.customer.id,customer:clone(retained.customer),
        currency:clone(old.currency),amount:retained.amount,receivedDate:retained.receivedDate,accountingDate:retained.accountingDate,
        method:retained.method,reference:retained.reference,note:split.reason,sourceKey:sha(json({kind:'BANK_RESIDUAL_RECEIPT',
          originalReceiptId:old.id,postingId:proposal.id,residualId:retained.id})),
        source:{...clone(retained.source),retainedFromReceiptId:old.id,bankCorrectionPostingId:proposal.id},
        bankSources:clone(retained.bankSources),status:'RECORDED',voidDate:null,createdAt:recordedAt,actor,
        replacesReceiptId:old.id,replacementRole:'RESIDUAL',history:[{at:recordedAt,actor,action:'bank_receipt_residual_retained',
          originalReceiptId:old.id,bankPostingId:proposal.id,amount:retained.amount,accountingDate:retained.accountingDate}]};
      result.receipts.unshift(residual);receiptIds.push(residual.id);
    }
  }
  for(const {selection,split}of selections) {
    let receipt;
    if(split.action==='LINK')receipt=result.receipts.find(row=>row.id===split.receiptId);
    else {
      receipt={id:split.receiptId,customerId:split.customer.id,customer:clone(split.customer),currency:clone(proposal.account.currency),
        amount:split.amount,receivedDate:selection.sourceRow.bookedDate,accountingDate:split.accountingDate,
        method:proposal.account.method,reference:split.reference,note:split.reason,
        sourceKey:sha(json({kind:'ORIGINAL_BANK_RECEIPT',bankAccountId:proposal.account.id,rowIdentity:selection.sourceRow.transactionKey??selection.sourceRow.economicKey,
          distinctPaymentId:selection.distinctPaymentReason?selection.sourceRow.id:null,splitId:split.id})),
        source:nativeReceiptSource({id:proposal.bankImportId,accountId:proposal.account.id,source:proposal.source,section:proposal.section},
          selection.sourceRow,proposal.id,split.id),
        status:'RECORDED',voidDate:null,createdAt:recordedAt,actor,history:[],
        ...(split.action==='CORRECT'?{replacesReceiptId:split.originalReceipt.id,replacementRole:'CORRECTION'}:{})};
      result.receipts.unshift(receipt);
    }
    const bankLink=plannedBankLink({id:proposal.bankImportId,accountId:proposal.account.id,source:proposal.source},
      selection.sourceRow,split,proposal.id,selection.distinctPaymentReason);
    receipt.bankSources??=[];
    if(!receipt.bankSources.some(row=>row.bankImportId===bankLink.bankImportId&&row.rowId===bankLink.rowId))receipt.bankSources.push(bankLink);
    receipt.history.push({at:recordedAt,actor,action:split.action==='LINK'?'bank_source_linked':'bank_receipt_recorded',
      bankImportId:proposal.bankImportId,bankPostingId:proposal.id,rowId:selection.rowId,receivedDate:receipt.receivedDate,
      accountingDate:receipt.accountingDate??receipt.receivedDate,amount:split.amount,sourceCoverage:clone(split.sourceCoverage)});
    receiptIds.push(receipt.id);
  }
  const planned=selections.flatMap(({split})=>[...split.allocations,...(split.residualReceipt?.allocations??[])])
    .sort((a,b)=>a.allocatedDate.localeCompare(b.allocatedDate)||a.id.localeCompare(b.id));
  for(const item of planned) {
    const invoice=result.invoices.find(row=>row.id===item.invoiceId),receipt=result.receipts.find(row=>row.id===item.receiptId),
      before=invoiceSummary(invoice,result,item.allocatedDate),funds=receiptSummary(receipt,result,item.allocatedDate);
    need(minor(item.amount,receipt.currency)<=minor(before.amountDue,receipt.currency)&&
      minor(item.amount,receipt.currency)<=minor(funds.available,receipt.currency),'BANK_ALLOCATION_EXCEEDS_BALANCE',
      'The selected invoice amount or receipt funds changed during this reviewed posting.',409);
    const allocation={id:item.id,invoiceId:invoice.id,receiptId:receipt.id,customerId:receipt.customerId,
      currency:clone(receipt.currency),amount:item.amount,minorAmount:minor(item.amount,receipt.currency).toString(),
      allocatedDate:item.allocatedDate,releasedDate:null,createdAt:recordedAt,actor,bankPostingId:proposal.id,
      history:[{at:recordedAt,actor,action:'allocated',allocatedDate:item.allocatedDate,bankPostingId:proposal.id}]};
    result.allocations.unshift(allocation);allocationIds.push(allocation.id);invoiceIds.add(invoice.id);
    receipt.history.push({at:recordedAt,actor,action:'allocated',allocationId:allocation.id,invoiceId:invoice.id,
      amount:allocation.amount,allocatedDate:allocation.allocatedDate,bankPostingId:proposal.id});
  }
  for(const id of new Set(receiptIds)) {
    const receipt=result.receipts.find(row=>row.id===id);
    assertReceiptConservation(receipt,result);receiptCoverageGroups(receipt);
  }
  for(const id of invoiceIds) {
    const invoice=result.invoices.find(row=>row.id===id);assertBankInvoiceConservation(result,invoice);
    invoice.version++;invoice.updatedAt=recordedAt;
    invoice.history.push({at:recordedAt,actor,action:'bank_receipts_posted',bankPostingId:proposal.id,
      receiptIds:[...new Set(receiptIds)],allocationIds:allocationIds.filter(id=>result.allocations.find(row=>row.id===id)?.invoiceId===invoice.id)});
  }
  return {data:result,receiptIds:[...new Set(receiptIds)],invoiceIds:[...invoiceIds],allocationIds};
}
export function compileBankPosting(data,bankImport,rows,customers,input,{prior=null}={}) {
  need(bankImport.status==='OPEN','BANK_IMPORT_CLOSED','Reopen this original import before changing its receipt assignments.',409);
  need(plain(input)&&Array.isArray(input.selections)&&input.selections.length>0&&input.selections.length<=100,
    'BANK_POSTING_SELECTIONS','Review between one and100 original bank credit rows.');
  const account=clone(bankImport.account),currency=account.currency,usedRows=new Set(),usedReceipts=new Map(),
    plannedCoverage=new Map(),corrections=new Map(),
    ids=new Set([...data.receipts.map(row=>row.id),...data.allocations.map(row=>row.id)]);
  const identity=(candidate,label)=>{const id=candidate?identifier(candidate,label):randomUUID();
    need(!ids.has(id),'BANK_POSTING_ID_REUSED','A generated receipt or allocation identifier already exists.',409);ids.add(id);return id;};
  const proposal={schema:BANK_POSTING_SCHEMA,id:prior?.id?identifier(prior.id,'bank posting'):randomUUID(),
    createdAt:prior?.createdAt??new Date().toISOString(),bankImportId:bankImport.id,account,source:clone(bankImport.source),
    section:clone(bankImport.section),normalizedSha256:bankImport.files['rows.json'].sha256,
    importStateSha256:sha(json({status:bankImport.status,decisions:bankImport.decisions,postings:bankImport.postings.map(row=>row.id)})),
    selections:[]};
  need(!bankImport.postings.some(row=>row.id===proposal.id),'BANK_POSTING_EXISTS','Recover the original retained posting request.',409);
  for(const [selectionIndex,value] of input.selections.entries()) {
    need(plain(value),'INVALID_BANK_SELECTION','Choose the retained bank row and its explicit customer splits.');
    const row=rows.find(row=>row.id===bankHash(value.rowId));
    need(row&&row.kind==='CREDIT'&&row.cashSource!==false&&row.sourceEligible!==false,
      'BANK_CASH_CREDIT_REQUIRED','Choose an eligible original incoming bank credit.',409);
    validateBankReplacement(data,bankImport,row,rows);
    need(!usedRows.has(row.id),'BANK_ROW_REPEATED','Choose each original bank row once.');usedRows.add(row.id);
    need(bankRowDecision(bankImport,row.id)?.status!=='IGNORED','BANK_ROW_IGNORED','Restore this original row before assigning a receipt.',409);
    need(Array.isArray(value.splits)&&value.splits.length>0&&value.splits.length<=100,'BANK_SPLITS_REQUIRED',
      'Review between one and100 explicit customer receipts for this original credit.');
    const distinctPaymentReason=optional(value.distinctPaymentReason,'distinct payment reason',3000),
      sourceResolutionReason=optional(value.sourceResolutionReason,'source resolution reason',3000),
      matches=bankSourceMatches(data,bankImport,row),exact=matches.filter(item=>item.match==='TRANSACTION_ID'),
      similar=matches.filter(item=>item.match==='SAME_PAYMENT_FIELDS');
    const superseding=matches.filter(item=>item.sourceIdentity?.correctionAction==='REPLACE'&&
      item.replacesTransactionKeys.includes(row.transactionKey)&&['POSTED','LINKED'].includes(item.status));
    need(!superseding.length,'BANK_SOURCE_SUPERSEDED',
      'Use the retained replacement source to correct its current receipt; this original FITID has already been superseded.',409);
    need(!(row.requiresSourceResolution||exact.some(item=>!item.sameFacts&&item.status!=='IGNORED'))||sourceResolutionReason,
      'BANK_SOURCE_CONFLICT_REVIEW','Explain the original statement correction when a retained transaction ID has different source amounts or dates.',409);
    const sameFile=rows.filter(item=>item.id!==row.id&&(sourceIds(item).some(key=>sourceIds(row).includes(key))||
      item.economicKey===row.economicKey&&!(item.transactionIdentity==='BANK_TRANSACTION_ID'&&row.transactionIdentity==='BANK_TRANSACTION_ID')));
    need(!sameFile.some(item=>item.transactionKey&&item.transactionKey===row.transactionKey&&item.sourceEligible!==false&&
      usedRows.has(item.id)),'BANK_TRANSACTION_SELECTED_TWICE','The selected rows contain the same original bank transaction ID.',409);
    const known=new Set([...(bankRowDecision(bankImport,row.id)?.receiptIds??[]).flatMap(id=>
      currentReceiptRows(data,id,bankImport,row).map(receipt=>receipt.id)),...exact.flatMap(item=>item.receiptIds),
      ...(!distinctPaymentReason?similar.flatMap(item=>item.receiptIds):[])]);
    const sourceRow=clone(row);delete sourceRow.raw;
    const selection={rowId:row.id,sourceRow,distinctPaymentReason,sourceResolutionReason,sourceMatches:matches,splits:[]},
      rowReceipts=new Set();
    let total=0n;
    for(const [splitIndex,raw] of value.splits.entries()) {
      need(plain(raw)&&['CREATE','LINK','CORRECT'].includes(raw.action),'INVALID_BANK_SPLIT_ACTION','Create, link or correct an original receipt.');
      const retained=prior?.selections?.[selectionIndex]?.splits?.[splitIndex],
        original=raw.action==='CREATE'?null:data.receipts.find(item=>item.id===identifier(raw.receiptId,'receipt'));
      need(raw.action==='CREATE'||original?.status==='RECORDED','BANK_RECEIPT_NOT_CURRENT','Choose an original recorded receipt.',409);
      if(original) {
        need(!rowReceipts.has(original.id),'BANK_RECEIPT_REPEATED','Combine this source row’s coverage of one original receipt into one split.');
        rowReceipts.add(original.id);
        need(!usedReceipts.has(original.id)||usedReceipts.get(original.id)===raw.action,'BANK_RECEIPT_ACTION_CONFLICT',
          'Link or correct one original receipt in this posting; do not link a receipt that this same posting replaces.',409);
        usedReceipts.set(original.id,raw.action);
        need(currencyKey(original.currency)===currencyKey(currency),'BANK_RECEIPT_CURRENCY','The original receipt currency differs from this bank account.',409);
      }
      const customerId=raw.customerId?identifier(raw.customerId,'customer'):original?.customerId,
        customer=customers.find(item=>item.id===customerId);
      need(customer,'CUSTOMER_NOT_FOUND','Choose an original saved accounting customer.',404);
      const amount=money(minor(raw.amount,currency,'customer split',{positive:true}),currency);total+=minor(amount,currency);
      const reason=optional(raw.reason,'receipt assignment reason',3000),
        dateDifferenceReason=optional(raw.dateDifferenceReason,'original received-date explanation',3000),
        coverageKey=raw.coverageKey==null?null:bankHash(raw.coverageKey,'original source coverage key');
      let effectiveDate=raw.effectiveDate?dateValue(raw.effectiveDate,'receipt accounting date'):row.bookedDate,
        accountingDate=maxDate(row.bookedDate,effectiveDate),sourceCoverage,correctedOriginalAmount=null;
      need(raw.action==='CORRECT'||raw.residualAllocations==null||Array.isArray(raw.residualAllocations)&&!raw.residualAllocations.length,
        'BANK_RESIDUAL_ALLOCATION_SCOPE','Residual invoice allocations belong to an explicit original receipt correction.');
      if(raw.action==='LINK') {
        need(original.customerId===customer.id,'BANK_RECEIPT_LINK_MISMATCH','Link the same original customer and currency.',409);
        need(original.receivedDate===row.bookedDate||dateDifferenceReason,'BANK_RECEIPT_DATE_REVIEW',
          'Explain why the original receipt date differs from the retained bank booked date.',409);
        need(!raw.effectiveDate||effectiveDate===(original.accountingDate??original.receivedDate),
          'BANK_LINK_DATE_IMMUTABLE','A source link preserves the original receipt accounting date.',409);
        accountingDate=original.accountingDate??original.receivedDate;effectiveDate=accountingDate;
        if(!plannedCoverage.has(original.id))plannedCoverage.set(original.id,clone(original.bankSources??[]));
        sourceCoverage=sourceCoverageReview(original,bankImport,row,matches,amount,distinctPaymentReason,
          plannedCoverage.get(original.id),coverageKey);
      } else if(raw.action==='CORRECT') {
        need(reason,'BANK_CORRECTION_REASON','Record why the original receipt is being corrected.');
        need(raw.effectiveDate,'BANK_CORRECTION_DATE','Choose the exact dated accounting correction.');
        const covered=receiptCoverageGroups(original),related=[...covered.groups.values()].filter(group=>
          group.links.some(link=>coverageLinksMatch(link,bankImport,row,matches,distinctPaymentReason))&&(!coverageKey||group.key===coverageKey));
        need(!(original.bankSources??[]).length||related.length===1,'BANK_RECEIPT_SOURCE_MISMATCH',
          'Choose the exact original bank coverage group being corrected; unrelated cash remains with its original customer.',409);
        need(!coverageKey||related.length===1,'BANK_SOURCE_COVERAGE_NOT_FOUND','Choose an original covered payment for this correction.',409);
        const selected=related[0],key=selected?.key??bankCoverageKey({bankAccountId:bankImport.accountId,
          transactionKey:row.transactionKey,economicKey:row.economicKey,distinctPaymentId:distinctPaymentReason?row.id:null}),
          portion=selected?.amount??minor(original.amount,currency);
        correctedOriginalAmount=money(portion,currency);
        if(!corrections.has(original.id))corrections.set(original.id,{original,effectiveDate,covered,
          keys:new Set(),amount:0n,splits:[],residualInputs:[],retained});
        const group=corrections.get(original.id);
        need(group.effectiveDate===effectiveDate,'BANK_CORRECTION_DATE_CONFLICT','Correct one original aggregate receipt at one reviewed accounting date.',409);
        need(!group.keys.has(key),'BANK_COVERAGE_CORRECTED_TWICE','Choose each original covered bank payment once when correcting this receipt.',409);
        group.keys.add(key);group.amount+=portion;
        need(group.amount<=minor(original.amount,currency),'BANK_CORRECTION_AMOUNT_EXCEEDED','The selected original portions exceed this receipt.',409);
        if(raw.residualAllocations!=null) {
          need(Array.isArray(raw.residualAllocations),'INVALID_BANK_ALLOCATION','Use explicit original-customer residual invoice allocations.');
          group.residualInputs.push(...raw.residualAllocations);
        }
        sourceCoverage={key,repeatedSource:false,receiptAmount:amount,beforeMatchedAmount:money(0n,currency),
          coveredByThisSource:amount,newlyMatchedAmount:amount,afterMatchedAmount:amount,remainingUnmatchedAmount:money(0n,currency),
          transactionKeys:[...new Set([...sourceIds(row),...(selected?.links??[]).flatMap(link=>
            [link.transactionKey,...(link.transactionAliases??[])].filter(Boolean))])]};
      } else {
        need(!coverageKey,'BANK_COVERAGE_SCOPE','Choose an existing source coverage key only when linking or correcting a receipt.');
        sourceCoverage=sourceCoverageReview({amount,currency,bankSources:[]},bankImport,row,[],amount,distinctPaymentReason,[]);
      }
      const splitId=identity(retained?.id,'bank split'),
        receiptId=raw.action==='LINK'?original.id:identity(retained?.receiptId,'new bank receipt'),
        allocationSeed=retained?.allocations?.map(item=>item.id),
        allocations=normalizeAllocations(data,customer.id,currency,raw.allocations,receiptId,accountingDate,allocationSeed);
      for(const allocation of allocations)identity(allocation.id,'bank allocation');
      const reference=raw.action==='LINK'?original.reference:field((row.reference.trim()||row.bankReference.trim()||row.transactionId||
        account.reference+' '+row.bookedDate+' '+row.rowNumber).slice(0,300),'receipt reference',300),
        split={id:splitId,action:raw.action,receiptId,customer:customerSnapshot(customer),amount,
          reference,effectiveDate,accountingDate,reason,dateDifferenceReason,coverageKey,sourceCoverage,
          originalReceipt:original?receiptBinding(original):null,correctedOriginalAmount,
          replacementReceiptIds:[],releasedAllocations:[],allocations};
      selection.splits.push(split);
      if(raw.action==='LINK')plannedCoverage.get(original.id).push(plannedBankLink(bankImport,row,split,proposal.id,distinctPaymentReason));
      if(raw.action==='CORRECT')corrections.get(original.id).splits.push(split);
    }
    need(total===minor(row.amount,currency),'BANK_SPLITS_NOT_CONSERVED','Customer receipt splits must equal the complete original bank credit exactly.');
    const selectedOriginals=new Set(selection.splits.map(split=>split.originalReceipt?.id).filter(Boolean));
    need([...known].every(id=>selectedOriginals.has(id)),'BANK_PAYMENT_ALREADY_RECORDED',
      'Link or correct every existing original receipt for this bank payment; do not create the same incoming cash again.',409);
    if(known.size)need(selection.splits.some(split=>split.action==='CORRECT')||selection.splits.every(split=>split.action==='LINK'),
      'BANK_PAYMENT_ALREADY_RECORDED','Add no new cash to a fully recorded bank payment unless correcting its original receipt split.',409);
    const unmatchedSimilar=similar.some(item=>item.status!=='IGNORED'&&item.receiptIds.length===0)||
      sameFile.some(item=>!item.transactionKey&&item.economicKey===row.economicKey&&item.sourceEligible!==false);
    need(!unmatchedSimilar||distinctPaymentReason||known.size,'BANK_SIMILAR_SOURCE_REVIEW',
      'Explain why coincident original payment fields represent separate incoming cash, or link the original receipt.',409);
    proposal.selections.push(selection);
  }
  for(const group of corrections.values()) {
    const {original,effectiveDate}=group,first=group.splits[0],
      remaining=minor(original.amount,currency)-group.amount;
    first.releasedAllocations=releaseForCorrection(data,original,effectiveDate,first.reason);
    const replacements=group.splits.map(split=>split.receiptId);
    if(remaining>0n) {
      const retained=group.retained?.residualReceipt,id=identity(retained?.id,'residual receipt'),
        customer=customers.find(row=>row.id===original.customerId);
      need(customer,'CUSTOMER_NOT_FOUND','The residual belongs to the original saved customer.',404);
      const accountingDate=maxDate(effectiveDate,original.accountingDate??original.receivedDate),
        allocations=normalizeAllocations(data,customer.id,currency,group.residualInputs,id,accountingDate,
          retained?.allocations?.map(row=>row.id));
      for(const allocation of allocations)identity(allocation.id,'residual allocation');
      const bankSources=(original.bankSources??[]).filter(link=>!group.keys.has(bankCoverageKey(link)));
      first.residualReceipt={id,customer:customerSnapshot(customer),amount:money(remaining,currency),
        receivedDate:original.receivedDate,accountingDate,reference:original.reference,method:original.method,
        source:clone(original.source),sourceKey:original.sourceKey??null,bankSources:clone(bankSources),allocations};
      replacements.push(id);
    } else need(!group.residualInputs.length,'BANK_NO_RESIDUAL_FUNDS','The reviewed correction leaves no residual receipt to allocate.');
    for(const split of group.splits)split.replacementReceiptIds=clone(replacements);
  }
  const applied=applyBankPostingChanges(data,proposal,'review',proposal.createdAt),
    dates=proposal.selections.flatMap(selection=>selection.splits.flatMap(split=>[split.effectiveDate,split.accountingDate,...split.allocations.map(row=>row.allocatedDate),...(split.residualReceipt?.allocations??[]).map(row=>row.allocatedDate)])),
    asOf=maxDate(today(),...dates),receiptEffects=[],invoiceEffects=[];
  for(const id of applied.receiptIds) {
    const before=data.receipts.find(row=>row.id===id),after=applied.data.receipts.find(row=>row.id===id),
      from=before?before.accountingDate??before.receivedDate:after.accountingDate??after.receivedDate,
      boundaries=[...new Set([...(before?receiptBalanceDates(before,data,from):[]),...receiptBalanceDates(after,applied.data,from),asOf])].sort();
    receiptEffects.push({id,customerId:after.customerId,currency:clone(currency),asOf,
      before:before?moneyProjection(receiptSummary(before,data,asOf)):null,after:moneyProjection(receiptSummary(after,applied.data,asOf)),
      periods:boundaries.map(date=>({asOf:date,before:before?moneyProjection(receiptSummary(before,data,date)):null,
        after:moneyProjection(receiptSummary(after,applied.data,date))}))});
  }
  for(const id of applied.invoiceIds) {
    const before=data.invoices.find(row=>row.id===id),after=applied.data.invoices.find(row=>row.id===id),
      boundaries=[...new Set([...invoiceDates(data,before,before.document.issueDate),...invoiceDates(applied.data,after,after.document.issueDate),asOf])].sort();
    invoiceEffects.push({id,number:after.number,customerId:after.draft.customerId,currency:clone(currency),asOf,
      before:moneyProjection(invoiceSummary(before,data,asOf)),after:moneyProjection(invoiceSummary(after,applied.data,asOf)),
      periods:boundaries.map(date=>({asOf:date,before:moneyProjection(invoiceSummary(before,data,date)),after:moneyProjection(invoiceSummary(after,applied.data,date))}))});
  }
  const sum=predicate=>money(proposal.selections.flatMap(row=>row.splits).filter(predicate).reduce((total,row)=>total+minor(row.amount,currency),0n),currency);
  const balanceEffects={asOf,receipts:receiptEffects,invoices:invoiceEffects,totals:{currency:clone(currency),
    sourceCredits:money(proposal.selections.reduce((total,row)=>total+minor(row.sourceRow.amount,currency),0n),currency),
    createdReceiptAmount:sum(row=>row.action==='CREATE'),linkedReceiptAmount:sum(row=>row.action==='LINK'),
    correctedReceiptAmount:sum(row=>row.action==='CORRECT'),
    allocatedAmount:money(proposal.selections.flatMap(row=>row.splits.flatMap(split=>[...split.allocations,...(split.residualReceipt?.allocations??[])])).reduce((total,row)=>total+minor(row.amount,currency),0n),currency)}};
  const review={proposal,balanceEffects},reviewSha256=sha(json(review));
  need(Buffer.byteLength(json({...review,reviewSha256}))<=1_750_000,'BANK_POSTING_REVIEW_LIMIT',
    'The full dated review exceeds1.75MB; choose fewer original rows in this posting.');
  return {...review,reviewSha256};
}
export function bankPostingInput(proposal) {
  need(plain(proposal)&&proposal.schema===BANK_POSTING_SCHEMA&&Array.isArray(proposal.selections),
    'BANK_POSTING_REVIEW_REQUIRED','Use the complete original bank posting preview.');
  return {selections:proposal.selections.map(selection=>({rowId:selection.rowId,distinctPaymentReason:selection.distinctPaymentReason,
    sourceResolutionReason:selection.sourceResolutionReason,splits:selection.splits.map(split=>({action:split.action,
      customerId:split.customer.id,receiptId:split.originalReceipt?.id,amount:split.amount,coverageKey:split.coverageKey,
      effectiveDate:split.effectiveDate,reason:split.reason,dateDifferenceReason:split.dateDifferenceReason,
      allocations:split.allocations.map(row=>({invoiceId:row.invoiceId,amount:row.amount,allocatedDate:row.allocatedDate})),
      ...(split.residualReceipt?{residualAllocations:split.residualReceipt.allocations.map(row=>
        ({invoiceId:row.invoiceId,amount:row.amount,allocatedDate:row.allocatedDate}))}:{})}))}))};
}

const htmlText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const DOC_STYLE='body{margin:0;color:#222;background:#fff;font:14px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:32px auto;padding:0 24px}h1{font-size:28px}h2{font-size:18px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}.amount{text-align:right;font-variant-numeric:tabular-nums}p{white-space:pre-line}';
function pageHtml(title,body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    htmlText(title)+'</title><style>'+DOC_STYLE+'</style></head><body><main><h1>'+htmlText(title)+'</h1>'+body+'</main></body></html>\n';
}
export function bankPostingDocuments(review,applied,actor,recordedAt) {
  const {proposal,balanceEffects,reviewSha256}=review,currency=proposal.account.currency,
    packet={schema:'stellar-forge.merchant-bank-posting.v1',id:proposal.id,recordedAt,actor,proposal,balanceEffects,reviewSha256,
      receiptIds:applied.receiptIds,invoiceIds:applied.invoiceIds,allocationIds:applied.allocationIds};
  const rows=proposal.selections.flatMap(selection=>selection.splits.map(split=>[selection.rowId,selection.sourceRow.bookedDate,
    selection.sourceRow.transactionId,split.action,split.customer.reference,split.customer.name,split.receiptId,
    split.originalReceipt?.id??'',split.amount,currency.code,split.accountingDate,split.allocations.map(row=>row.invoiceNumber+': '+row.amount).join('; '),
    split.reason,selection.distinctPaymentReason,selection.sourceResolutionReason]));
  const headers=['source_row','bank_date','bank_transaction_id','action','customer_reference','customer','receipt_id','replaces_receipt_id',
    'amount','currency','accounting_date','invoice_allocations','reason','distinct_payment_reason','source_resolution_reason'];
  const result=[
    {name:'posting-'+proposal.id+'.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(packet))},
    {name:'posting-'+proposal.id+'.csv',type:'text/csv; charset=utf-8',bytes:Buffer.from(csv([headers,...rows]))},
    {name:'posting-'+proposal.id+'.html',type:'text/html; charset=utf-8',bytes:Buffer.from(pageHtml('Bank receipt posting',
      '<p>Original source: '+htmlText(proposal.source.name)+'\nBank account: '+htmlText(proposal.account.reference)+'\nRecorded '+htmlText(recordedAt)+'</p>'+
      '<table><thead><tr><th>Customer</th><th>Action</th><th>Bank date</th><th>Accounting date</th><th>Currency</th><th class="amount">Receipt</th><th>Invoice allocations</th></tr></thead><tbody>'+
      proposal.selections.flatMap(selection=>selection.splits.map(split=>'<tr><td>'+htmlText(split.customer.name)+'</td><td>'+htmlText(split.action)+'</td><td>'+
        htmlText(selection.sourceRow.bookedDate)+'</td><td>'+htmlText(split.accountingDate)+'</td><td>'+htmlText(currency.code)+'</td><td class="amount">'+
        htmlText(split.amount)+'</td><td>'+htmlText(split.allocations.map(row=>row.invoiceNumber+': '+row.amount).join('; '))+'</td></tr>')).join('')+'</tbody></table>'))}
  ];
  for(const receiptId of applied.receiptIds) {
    const receipt=applied.data.receipts.find(row=>row.id===receiptId),related=proposal.selections.flatMap(selection=>
      selection.splits.filter(split=>split.receiptId===receiptId||split.originalReceipt?.id===receiptId||
        split.residualReceipt?.id===receiptId).map(split=>({selection,split}))),
      allocations=related.flatMap(({split})=>[...split.allocations,...(split.residualReceipt?.allocations??[])])
        .filter(row=>row.receiptId===receiptId),
      sourceLinks=(receipt.bankSources??[]).map(link=>({bookedDate:link.bookedDate,
        matchedAmount:link.splitAmount,sourceAmount:link.sourceAmount,coverageKey:bankCoverageKey(link)})),
      advice={schema:'stellar-forge.merchant-bank-receipt-advice.v1',postingId:proposal.id,recordedAt,customer:clone(receipt.customer),
        receipt:{id:receipt.id,reference:receipt.reference,method:receipt.method,amount:receipt.amount,currency:clone(currency),
          receivedDate:receipt.receivedDate,accountingDate:receipt.accountingDate??receipt.receivedDate,
          status:receipt.status,voidDate:receipt.voidDate??null,replacesReceiptId:receipt.replacesReceiptId??null,
          replacementReceiptIds:clone(receipt.replacementReceiptIds??[]),replacementRole:receipt.replacementRole??null},
        allocations:allocations.map(row=>({id:row.id,invoiceId:row.invoiceId,invoiceNumber:row.invoiceNumber,
          amount:row.amount,allocatedDate:row.allocatedDate})),sourceLinks,
        reasons:[...new Set(related.map(({split})=>split.reason).filter(Boolean))],
        dateDifferenceReasons:[...new Set(related.map(({split})=>split.dateDifferenceReason).filter(Boolean))]};
    const metadata={customerId:receipt.customerId,receiptId:receipt.id,
      accountingDate:receipt.status==='VOID'?receipt.voidDate:advice.receipt.accountingDate};
    result.push(
      {name:'receipt-'+receipt.id+'.json',type:'application/json; charset=utf-8',...metadata,bytes:Buffer.from(json(advice))},
      {name:'receipt-'+receipt.id+'.csv',type:'text/csv; charset=utf-8',...metadata,
        bytes:Buffer.from(csv([['receipt_id','reference','customer','currency','amount','received_date','accounting_date',
          'status','void_date','replaces_receipt_id','replacement_receipt_ids','replacement_role'],
          [receipt.id,receipt.reference,receipt.customer.name,currency.code,receipt.amount,receipt.receivedDate,
            advice.receipt.accountingDate,receipt.status,receipt.voidDate,advice.receipt.replacesReceiptId,
            advice.receipt.replacementReceiptIds.join(';'),advice.receipt.replacementRole]]))},
      {name:'receipt-'+receipt.id+'.html',type:'text/html; charset=utf-8',...metadata,
        bytes:Buffer.from(pageHtml('Payment receipt','<h2>'+htmlText(receipt.customer.name)+'</h2><p>Reference: '+htmlText(receipt.reference)+
          '\nAmount: '+htmlText(currency.code+' '+receipt.amount)+'\nReceived: '+htmlText(receipt.receivedDate)+
          '\nAccounting date: '+htmlText(advice.receipt.accountingDate)+'\nStatus: '+htmlText(receipt.status)+
          (receipt.voidDate?'\nCorrection date: '+htmlText(receipt.voidDate):'')+'</p>'+
          (receipt.replacesReceiptId?'<p>Original receipt: '+htmlText(receipt.replacesReceiptId)+
            '. '+htmlText(receipt.replacementRole==='RESIDUAL'?'Remaining original customer payment.':'Corrected customer payment.')+'</p>':'')+
          '<p>'+htmlText(advice.reasons.join('\n'))+'</p>'+
          '<table><thead><tr><th>Invoice</th><th>Allocation date</th><th>Currency</th><th class="amount">Amount applied</th></tr></thead><tbody>'+
          allocations.map(row=>'<tr><td>'+htmlText(row.invoiceNumber)+'</td><td>'+htmlText(row.allocatedDate)+'</td><td>'+
            htmlText(currency.code)+'</td><td class="amount">'+htmlText(row.amount)+'</td></tr>').join('')+'</tbody></table>'+
          (sourceLinks.length?'<h2>Original bank source coverage</h2><table><thead><tr><th>Bank date</th><th>Currency</th><th class="amount">Amount matched to this receipt</th></tr></thead><tbody>'+
            [...receiptCoverageGroups(receipt).groups.values()].map(group=>'<tr><td>'+htmlText(group.links[0].bookedDate)+
              '</td><td>'+htmlText(currency.code)+'</td><td class="amount">'+htmlText(money(group.amount,currency))+'</td></tr>').join('')+
              '</tbody></table>':'')))});
  }
  return result;
}
