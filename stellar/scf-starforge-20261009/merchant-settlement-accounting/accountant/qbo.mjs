// MIT. QuickBooks Online journals from the original frozen accountant handoff.
import {createHash} from 'node:crypto';
import {accountantColumns,inspectHandoff,parseReturnCsv,renderCsv,validateHandoff,validateRevision} from './engine.mjs';
import {validateQboCompany} from './qbo-company.mjs';

export const QBO_PLAN_SCHEMA='stellar-forge.quickbooks-journal-plan.v1';
export const QBO_RESPONSE_SCHEMA='stellar-forge.quickbooks-journal-response.v1';
export const QBO_CURRENCIES=Object.freeze(['USD','CAD','EUR','GBP','AUD','NZD']);
export const QBO_DOCS=Object.freeze([
  {title:'Intuit JournalEntry create request',url:'https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-4d0c72cc-0585-4485-9221-9f3551b6e493'},
  {title:'Intuit JournalEntry schema',url:'https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/JournalEntry.html'},
  {title:'Intuit accounting API entities',url:'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry'}
]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const HEX=/^[a-f0-9]{64}$/;
export const qboHash=value=>createHash('sha256').update(value).digest('hex');
export function qboCheck(ok,code,message,status=400){if(!ok)throw Object.assign(new Error(message),{code,status});}
export function qboCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){qboCheck(Number.isFinite(value),'QBO_INVALID_RECORD','Use finite JSON numbers.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(qboCanonical).join(',')+']';
  qboCheck(object(value),'QBO_INVALID_RECORD','Use JSON records.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+qboCanonical(value[key])).join(',')+'}';
}
export const qboJson=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const seal=body=>({...body,integrity:{sha256:qboHash(qboCanonical(body))}});
export function qboId(value){
  qboCheck(typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),'QBO_INVALID_ID','Use the retained request ID.');
  return value;
}
export function qboText(value,label,max=160,{empty=false}={}){
  qboCheck(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).test(value),
    'QBO_INVALID_FIELD','Check '+label+'.');return value;
}
const target=(value,label)=>{qboCheck(typeof value==='string'&&/^[0-9]{1,64}$/.test(value),'QBO_INVALID_REFERENCE','Use the exact QuickBooks '+label+' as text.');return value;};
const timestamp=value=>{qboCheck(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),'QBO_INVALID_TIME','Use a creation time with its time zone.');return value;};
function date(value){
  qboCheck(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,
    'QBO_INVALID_POSTING_DATE','Choose an explicit valid posting date.');return value;
}
function minorUnits(value,{zero=false}={}){
  const text=typeof value==='number'?String(value):value;
  qboCheck(typeof text==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text),'QBO_INVALID_AMOUNT','Use an exact home-currency amount with at most two decimal places and at most 999999999.99.');
  const [major,fraction='']=text.split('.'),minor=BigInt(major)*100n+BigInt(fraction.padEnd(2,'0'));
  qboCheck(zero||minor>0n,'QBO_INVALID_AMOUNT','Each selected event needs a positive reviewed home-currency amount.');return minor;
}
const money=minor=>String(minor/100n)+'.'+String(minor%100n).padStart(2,'0');
function account(value,currency){
  qboCheck(object(value),'QBO_ACCOUNT_REQUIRED','Choose the debit and credit QuickBooks accounts.');
  const result={value:target(value.value,'Account.Id')};
  if(value.name!==undefined&&value.name!=='')result.name=qboText(value.name,'account name',1000);
  if(value.Active!==undefined)qboCheck(value.Active===true,'QBO_INACTIVE_ACCOUNT','Choose an active QuickBooks account.');
  if(value.CurrencyRef?.value)qboCheck(value.CurrencyRef.value===currency,'QBO_ACCOUNT_CURRENCY','Use accounts in the selected home currency.');
  if(value.AccountType!==undefined)qboCheck(['Bank','Other Current Asset','Fixed Asset','Other Asset','Credit Card','Other Current Liability','Long Term Liability','Equity','Income','Cost of Goods Sold','Expense','Other Income','Other Expense'].includes(value.AccountType),'QBO_ENTITY_ACCOUNT','Choose a supported posting account that does not require a customer or vendor on the journal line.');
  return result;
}
const assignment=row=>Object.fromEntries(['externalStatus','externalBookRef','externalAccountCode','externalNote'].map(key=>[key,row[key]??'']));
const assignmentHash=row=>qboHash(qboCanonical(assignment(row)));
function lineDescription(row){return 'SCF '+row.rowId+(row.description?' | '+row.description:'');}
function makeJournal(plan){
  return {TxnDate:plan.txnDate,DocNumber:plan.docNumber,PrivateNote:'Stellar Forge '+plan.id+'; handoff '+plan.handoffId,
    CurrencyRef:{value:plan.baseCurrency},Line:plan.rows.flatMap(row=>['Debit','Credit'].map(type=>({
      Amount:Number(minorUnits(row.amount))/100,Description:lineDescription(row),DetailType:'JournalEntryLineDetail',
      JournalEntryLineDetail:{PostingType:type,AccountRef:clone(type==='Debit'?row.debitAccount:row.creditAccount)}
    })))};
}

/** Operator valuations are separate from atomic settlement amounts and quotes. */
export function createQboPlan({handoff,revision=null,id,name,actor,createdAt,realmId,companyName,baseCurrency,environment='sandbox',txnDate,docNumber,rows,companySnapshot=null}={}){
  validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
  qboId(id);qboText(name,'journal name');qboText(actor,'operator',1000);timestamp(createdAt);
  target(realmId,'company realm ID');qboText(companyName,'company name',200);
  let companyAccounts=null;
  if(companySnapshot){
    validateQboCompany(companySnapshot);
    qboCheck(companySnapshot.realmId===realmId&&companySnapshot.companyName===companyName&&companySnapshot.baseCurrency===baseCurrency,'QBO_COMPANY_SETUP_CHANGED','Use the company name, realm and home currency from the imported native setup.',409);
    companyAccounts=new Map(companySnapshot.accounts.map(item=>[item.value,item]));
  }
  qboCheck(QBO_CURRENCIES.includes(baseCurrency),'QBO_CURRENCY_UNSUPPORTED','Choose a supported two-decimal home currency: '+QBO_CURRENCIES.join(', ')+'.');
  qboCheck(['sandbox','production'].includes(environment),'QBO_ENVIRONMENT_REQUIRED','Choose QuickBooks sandbox or production.');
  date(txnDate);
  docNumber=docNumber===undefined||docNumber===null||docNumber===''?('SF'+id.replaceAll('-','').slice(0,19)):docNumber;
  qboText(docNumber,'document number',21);
  qboCheck(Array.isArray(rows)&&rows.length>0&&rows.length<=500,'QBO_ROW_LIMIT','Select between 1 and 500 source events.');
  const sourceRows=new Map(inspectHandoff(handoff,revision).rows.map(row=>[row.rowId,row])),seen=new Set();
  const selected=rows.map(selection=>{
    qboCheck(object(selection)&&typeof selection.rowId==='string'&&HEX.test(selection.rowId),'QBO_SOURCE_ROW_REQUIRED','Choose a frozen handoff event.');
    const row=sourceRows.get(selection.rowId);
    qboCheck(row&&!seen.has(row.rowId),'QBO_SOURCE_ROW_CONFLICT','Each selected event must occur exactly once in this handoff.');seen.add(row.rowId);
    qboCheck(!['BOOKED','EXCLUDED'].includes(row.externalStatus),'QBO_ALREADY_ACCOUNTED','A selected event is already booked or excluded; review its original accountant return.',409);
    if(environment==='production')qboCheck(row.original.network==='stellar:pubnet'&&row.original.transfer==='OFFICIAL_TRANSFER_MATCHED',
      'QBO_PRODUCTION_SOURCE_REQUIRED','Production journals require the original matched public-network transfer; use sandbox for a testnet workflow.');
    const selectedAccount=input=>{
      if(!companyAccounts)return account(input,baseCurrency);
      const native=companyAccounts.get(input?.value);
      qboCheck(native?.selectable===true,'QBO_ACCOUNT_NOT_SELECTABLE','Choose an active, supported home-currency account from the imported company setup.');
      return account(native,baseCurrency);
    };
    const debitAccount=selectedAccount(selection.debitAccount),creditAccount=selectedAccount(selection.creditAccount);
    qboCheck(debitAccount.value!==creditAccount.value,'QBO_SAME_ACCOUNTS','Choose different debit and credit accounts for the event.');
    return {rowId:row.rowId,eventId:row.eventId,sourceRowSha256:row.sourceRowSha256,assignmentSha256:assignmentHash(row),
      sourceNetwork:row.original.network,sourceAmountAtomic:row.original.amountAtomic,sourceLabel:clone(row.label),sourceAdjustments:clone(row.adjustments??null),
      amount:money(minorUnits(selection.amount)),debitAccount,creditAccount,description:qboText(selection.description??'','line description',1000,{empty:true})};
  });
  const total=selected.reduce((sum,row)=>sum+minorUnits(row.amount),0n);
  const plan={schema:QBO_PLAN_SCHEMA,id,name,actor,createdAt,handoffId:handoff.id,handoffSha256:handoff.integrity.sha256,
    accountantRevisionId:revision?.id??null,accountantRevisionSha256:revision?.integrity.sha256??null,
    source:clone(handoff.source),realmId,companyName,baseCurrency,environment,txnDate,docNumber,companySnapshot:clone(companySnapshot),rows:selected,
    summary:{rowCount:selected.length,lineCount:selected.length*2,totalDebit:money(total),totalCredit:money(total)},docs:clone(QBO_DOCS)};
  plan.journalEntry=makeJournal(plan);
  return seal(plan);
}
export function validateQboPlan(plan){
  qboCheck(object(plan)&&plan.schema===QBO_PLAN_SCHEMA&&object(plan.integrity),'QBO_INVALID_PLAN','Choose a retained QuickBooks plan.');
  const {integrity,...body}=plan;
  qboCheck(HEX.test(integrity.sha256)&&qboHash(qboCanonical(body))===integrity.sha256,'QBO_PLAN_CHANGED','The retained journal plan changed.',409);
  qboId(plan.id);qboId(plan.handoffId);
  if(plan.companySnapshot){validateQboCompany(plan.companySnapshot);qboCheck(plan.companySnapshot.realmId===plan.realmId&&plan.companySnapshot.baseCurrency===plan.baseCurrency,'QBO_COMPANY_SETUP_CHANGED','The retained native company setup changed.',409);}
  qboCheck(Array.isArray(plan.rows)&&plan.rows.length>0&&plan.rows.length<=500&&qboCanonical(plan.journalEntry)===qboCanonical(makeJournal(plan)),
    'QBO_JOURNAL_CHANGED','The retained journal no longer matches its frozen event mappings.',409);
  return plan;
}
function currentRows(plan,handoff,revision){
  validateQboPlan(plan);validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
  qboCheck(handoff.id===plan.handoffId&&handoff.integrity.sha256===plan.handoffSha256,'QBO_HANDOFF_CHANGED','Use this plan’s original handoff.',409);
  const rows=new Map(inspectHandoff(handoff,revision).rows.map(row=>[row.rowId,row]));
  for(const selected of plan.rows){
    const row=rows.get(selected.rowId);
    qboCheck(row&&row.sourceRowSha256===selected.sourceRowSha256&&assignmentHash(row)===selected.assignmentSha256,
      'QBO_ACCOUNTANT_CHANGED','A selected event’s accountant status or notes changed. Prepare a new journal from the current handoff.',409);
  }
  return rows;
}
export function checkQboSource(plan,handoff,revision){currentRows(plan,handoff,revision);return true;}
function comparableLine(line){
  qboCheck(object(line)&&line.DetailType==='JournalEntryLineDetail'&&object(line.JournalEntryLineDetail),'QBO_RESPONSE_LINE','The response contains an unsupported journal line.');
  const detail=line.JournalEntryLineDetail;
  qboCheck(['Debit','Credit'].includes(detail.PostingType)&&object(detail.AccountRef),'QBO_RESPONSE_LINE','The response must retain each posting side and account.');
  for(const key of ['Entity','ClassRef','DepartmentRef','TaxCodeRef','TaxApplicableOn','JournalCodeRef'])
    qboCheck(detail[key]===undefined||detail[key]===null,'QBO_RESPONSE_UNEXPECTED_DETAIL','The response adds '+key+' to the reviewed journal.',409);
  for(const key of ['TaxAmount','TaxInclusiveAmt'])qboCheck(detail[key]===undefined||detail[key]===null||Number(detail[key])===0,'QBO_RESPONSE_UNEXPECTED_DETAIL','The response adds a tax amount.',409);
  qboCheck(detail.BillableStatus===undefined||detail.BillableStatus===null||detail.BillableStatus==='NotBillable','QBO_RESPONSE_UNEXPECTED_DETAIL','The response changes journal billability.',409);
  return qboCanonical({amount:money(minorUnits(line.Amount)),description:qboText(line.Description??'','returned line description',4000,{empty:true}),
    postingType:detail.PostingType,account:target(detail.AccountRef.value,'returned Account.Id')});
}
export function inspectQboResponse({plan,responseBytes,realmId,id,name,actor,createdAt}={}){
  validateQboPlan(plan);qboId(id);qboText(name,'response name');qboText(actor,'operator',1000);timestamp(createdAt);
  qboCheck(realmId===plan.realmId,'QBO_COMPANY_MISMATCH','Import the response under the company realm retained in this journal.',409);
  qboCheck(Buffer.isBuffer(responseBytes)||responseBytes instanceof Uint8Array,'QBO_RESPONSE_BYTES','Import the original QuickBooks JSON bytes.');
  const bytes=Buffer.from(responseBytes);qboCheck(bytes.length>0&&bytes.length<=8*1024*1024,'QBO_RESPONSE_SIZE','Choose a nonempty QuickBooks JSON response of at most 8 MiB.');
  let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(new Error('The QuickBooks response must be UTF-8 JSON.'),{code:'QBO_RESPONSE_JSON',status:400});}
  qboCheck(object(document),'QBO_RESPONSE_JSON','Import a native QuickBooks JSON object.');
  if(document.realmId!==undefined)qboCheck(document.realmId===realmId,'QBO_COMPANY_MISMATCH','The response wrapper names another company.',409);
  const base={schema:QBO_RESPONSE_SCHEMA,id,name,actor,createdAt,planId:plan.id,planSha256:plan.integrity.sha256,realmId,
    responseSha256:qboHash(bytes),responseBytes:bytes.length,journalEntryId:null,syncToken:null};
  qboCheck(!(document.Fault&&document.JournalEntry),'QBO_AMBIGUOUS_RESPONSE','The response contains both an error and a journal.');
  if(document.Fault){
    qboCheck(object(document.Fault)&&Array.isArray(document.Fault.Error)&&document.Fault.Error.length>0&&document.Fault.Error.length<=100,
      'QBO_FAULT_SHAPE','Import the complete native QuickBooks Fault.Error response.');
    return seal({...base,kind:'FAULT',errors:document.Fault.Error.map(error=>({code:String(error.code??'').slice(0,100),
      message:String(error.Message??'').slice(0,2000),detail:String(error.Detail??'').slice(0,4000)})),summary:{matchedRows:0}});
  }
  const journal=document.JournalEntry;
  qboCheck(object(journal),'QBO_JOURNAL_REQUIRED','Import a native response containing JournalEntry or Fault.');
  const journalEntryId=target(journal.Id,'JournalEntry.Id');
  qboCheck((journal.domain===undefined||journal.domain==='QBO')&&![journal.status,journal.TxnStatus].some(value=>/^(deleted|void|voided)$/i.test(String(value??''))),'QBO_INACTIVE_JOURNAL','Use an active QuickBooks Online journal response.',409);
  qboCheck(typeof journal.SyncToken==='string'&&/^\d{1,30}$/.test(journal.SyncToken),'QBO_VERSION_REQUIRED','Retain the returned QuickBooks SyncToken.');
  qboCheck(journal.TxnDate===plan.txnDate&&journal.DocNumber===plan.docNumber&&journal.PrivateNote===plan.journalEntry.PrivateNote,
    'QBO_RESPONSE_IDENTITY','The returned posting date, document number or plan reference differs from the reviewed journal.',409);
  const currencyMatches=journal.CurrencyRef?.value===plan.baseCurrency||(!journal.CurrencyRef&&plan.companySnapshot?.multiCurrencyEnabled===false);
  qboCheck(currencyMatches&&(journal.ExchangeRate===undefined||Number(journal.ExchangeRate)===1),
    'QBO_RESPONSE_CURRENCY','The response must use the reviewed home currency without currency conversion.',409);
  const tax=journal.TxnTaxDetail;
  const zeroTax=tax===undefined||tax===null||(object(tax)&&Object.keys(tax).every(key=>['TotalTax','TaxLine'].includes(key))&&
    (tax.TotalTax===undefined||Number(tax.TotalTax)===0)&&(tax.TaxLine===undefined||Array.isArray(tax.TaxLine)&&tax.TaxLine.length===0));
  qboCheck(zeroTax&&(!journal.GlobalTaxCalculation||journal.GlobalTaxCalculation==='NotApplicable')&&!journal.Adjustment&&!journal.HomeCurrencyAdjustment,
    'QBO_RESPONSE_TAX_OR_ADJUSTMENT','The response adds tax or adjustment behavior absent from the reviewed journal.',409);
  qboCheck(Array.isArray(journal.Line)&&journal.Line.length===plan.journalEntry.Line.length,'QBO_RESPONSE_LINE_COUNT','The response must contain exactly the reviewed journal lines.',409);
  const expected=plan.journalEntry.Line.map(comparableLine).sort(),actual=journal.Line.map(comparableLine).sort();
  qboCheck(qboCanonical(expected)===qboCanonical(actual),'QBO_RESPONSE_MISMATCH','The returned amounts, accounts, posting sides or event descriptions differ from the reviewed journal.',409);
  return seal({...base,kind:'MATCHED',journalEntryId,syncToken:journal.SyncToken,errors:[],
    summary:{matchedRows:plan.rows.length,lineCount:journal.Line.length,totalDebit:plan.summary.totalDebit,totalCredit:plan.summary.totalCredit}});
}
export function validateQboResult(result){
  qboCheck(object(result)&&result.schema===QBO_RESPONSE_SCHEMA&&object(result.integrity),'QBO_INVALID_RESULT','Use a retained QuickBooks response result.');
  const {integrity,...body}=result;
  qboCheck(HEX.test(integrity.sha256)&&qboHash(qboCanonical(body))===integrity.sha256,'QBO_RESULT_CHANGED','The retained QuickBooks result changed.',409);
  qboId(result.id);qboId(result.planId);target(result.realmId,'company realm ID');
  if(result.kind==='MATCHED'){target(result.journalEntryId,'JournalEntry.Id');qboCheck(typeof result.syncToken==='string'&&/^\d{1,30}$/.test(result.syncToken),'QBO_VERSION_REQUIRED','Retain the QuickBooks SyncToken.');}
  else qboCheck(result.kind==='FAULT','QBO_INVALID_RESULT','Use a native matched response or Fault.');
  return result;
}
const spreadsheet=value=>/^['\t\r\n]/.test(value)||/^\s*[=+\-@]/u.test(value)?"'"+value:value;
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
export function qboReturnCsv(plan,result,handoff,revision){
  const rows=currentRows(plan,handoff,revision);validateQboResult(result);
  qboCheck(result.kind==='MATCHED'&&result.planId===plan.id&&result.planSha256===plan.integrity.sha256&&result.realmId===plan.realmId,
    'QBO_MATCHED_RESPONSE_REQUIRED','Use the matched response for this reviewed journal.');
  const selected=new Map(plan.rows.map(row=>[row.rowId,row])),columns=accountantColumns(handoff);
  const parsed=parseReturnCsv(renderCsv(handoff,revision),{columns});
  const cells=parsed.records.map(record=>{
    const values=[...record.values],rawRowId=values[columns.indexOf('rowId')],rowId=rawRowId.startsWith("'")?rawRowId.slice(1):rawRowId,mapping=selected.get(rowId);
    if(mapping){
      const originalNote=rows.get(rowId).externalNote;
      const expandedNote=[originalNote,'QuickBooks Online '+plan.environment+' company '+plan.realmId+
        ', JournalEntry '+result.journalEntryId+', version '+result.syncToken+', '+mapping.amount+' '+plan.baseCurrency+'.'].filter(Boolean).join('\n');
      // The original note remains intact when native metadata would exceed the accountant limit.
      const note=expandedNote.length<=4000?expandedNote:originalNote;
      qboText(note,'accountant note',4000,{empty:true});
      const edits={externalStatus:'BOOKED',externalBookRef:'QBO:'+plan.realmId+':'+result.journalEntryId,
        externalAccountCode:mapping.debitAccount.value+'>'+mapping.creditAccount.value,externalNote:note};
      for(const [key,value] of Object.entries(edits))values[columns.indexOf(key)]=spreadsheet(value);
    }
    return values.map(quote).join(',');
  });
  return Buffer.from([columns.map(quote).join(','),...cells].join('\r\n')+'\r\n','utf8');
}
const html=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function renderQboReview(plan){
  validateQboPlan(plan);
  return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuickBooks journal review</title>'+
    '<style>body{font:15px system-ui;color:#222;max-width:1200px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}small{overflow-wrap:anywhere}pre{white-space:pre-wrap}</style>'+
    '<h1>'+html(plan.name)+'</h1><p>'+html(plan.companyName)+' · '+html(plan.realmId)+' · '+html(plan.environment)+' · '+html(plan.baseCurrency)+'</p>'+
    '<p>Posting date '+html(plan.txnDate)+' · Document '+html(plan.docNumber)+' · '+html(plan.summary.rowCount)+' events</p>'+
    '<p>Debit '+html(plan.summary.totalDebit)+' · Credit '+html(plan.summary.totalCredit)+'</p><table><thead><tr><th>Source event</th><th>Original atomic amount</th><th>Reviewed home amount</th><th>Debit account</th><th>Credit account</th></tr></thead><tbody>'+
    plan.rows.map(row=>'<tr><td><small>'+html(row.eventId)+'</small><br>'+html(row.description)+'</td><td>'+html(row.sourceAmountAtomic)+'<br>'+html(row.sourceNetwork)+(row.sourceAdjustments?'<br><small>Returned '+html(row.sourceAdjustments.refundedAmountAtomic)+' · remaining '+html(row.sourceAdjustments.remainingAmountAtomic)+' · pending return '+html(row.sourceAdjustments.pendingRefundAmountAtomic)+' · cancelled '+html(row.sourceAdjustments.cancelledAmountAtomic)+'</small>':'')+'</td><td>'+html(row.amount)+' '+html(plan.baseCurrency)+'</td><td>'+html(row.debitAccount.name??'')+' ('+html(row.debitAccount.value)+')</td><td>'+html(row.creditAccount.name??'')+' ('+html(row.creditAccount.value)+')</td></tr>').join('')+
    '</tbody></table><h2>Frozen source</h2><p>Handoff '+html(plan.handoffId)+'<br>Report '+html(plan.source.reportSha256)+'<br>Plan '+html(plan.integrity.sha256)+'</p></html>','utf8');
}

