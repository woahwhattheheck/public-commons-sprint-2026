// MIT. Xero manual journals from original merchant accounting source.
import {createHash,randomUUID} from 'node:crypto';
import {validateHandoff,validateRevision,inspectHandoff,renderCsv,parseReturnCsv,accountantColumns,EDITABLE_COLUMNS} from './engine.mjs';
import {validateAdjustment} from '../adjustments.mjs';

export const XERO_CONTEXT_SCHEMA='stellar-forge.xero-context.v1';
export const XERO_PLAN_SCHEMA='stellar-forge.xero-journal-plan.v1';
export const XERO_CAPTURE_SCHEMA='stellar-forge.xero-journal-capture.v1';
export const XERO_DOCS=Object.freeze({
  journals:'https://developer.xero.com/documentation/api/accounting/manualjournals/',
  schema:'https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml',
  accounts:'https://developer.xero.com/documentation/api/accounting/accounts/',
  organization:'https://developer.xero.com/documentation/api/accounting/organisation/',
  systemAccounts:'https://central.xero.com/0/article/Locked-and-system-accounts-in-your-chart-of-accounts'
});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const xeroHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const xeroCheck=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
export function xeroId(value){xeroCheck(typeof value==='string'&&UUID.test(value),'INVALID_XERO_ID','Use the retained lower-case UUID.');return value;}
export function xeroText(value,label,max=2000,{empty=false,multiline=false}={}){
  xeroCheck(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&
    !(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value),
    'INVALID_XERO_TEXT',label+' must be '+(empty?'':'nonempty ')+'text of at most '+max+' characters.');return value.trim();
}
export function xeroCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){xeroCheck(Number.isFinite(value),'INVALID_XERO_RECORD','The record contains an invalid number.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(xeroCanonical).join(',')+']';
  xeroCheck(object(value),'INVALID_XERO_RECORD','Use JSON-compatible records.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+xeroCanonical(value[key])).join(',')+'}';
}
export const xeroJson=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function xeroParse(value,label='Xero source'){
  const bytes=Buffer.from(value);xeroCheck(bytes.length>0&&bytes.length<=64_000_000,'INVALID_XERO_SOURCE_SIZE',label+' must contain at most 64 MB.');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(new Error(label+' must contain original UTF-8 JSON.'),{code:'INVALID_XERO_JSON'});}
}
const clone=value=>JSON.parse(xeroCanonical(value));
const seal=value=>({...value,sha256:xeroHash(xeroCanonical(value))});
function verify(value,schema){xeroCheck(object(value)&&value.schema===schema&&SHA.test(value.sha256??''),'INVALID_XERO_RECORD','Use a retained Xero record of the expected type.');const {sha256,...body}=value;xeroCheck(xeroHash(xeroCanonical(body))===sha256,'XERO_RECORD_CHANGED','The retained Xero record changed.',409);return value;}
function instant(value){xeroCheck(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),'INVALID_XERO_TIMESTAMP','Use a timestamp with an explicit time zone.');return value;}
export function xeroDate(value){xeroCheck(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'INVALID_XERO_DATE','Choose a valid YYYY-MM-DD journal date.');return value;}
export function xeroCents(value,{signed=false,zero=false}={}){
  xeroCheck(typeof value==='string'&&(signed?/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/:/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/).test(value),'INVALID_XERO_AMOUNT','Enter the base-currency amount as plain decimal text with at most two decimal places.');
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.'),amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')),result=negative?-amount:amount;
  xeroCheck((zero||result!==0n)&&(signed||result>0n)&&result>=-999999999999n&&result<=999999999999n,'INVALID_XERO_AMOUNT','Use a nonzero amount within the supported journal value range.');return result;
}
export function xeroMoney(value){const negative=value<0n,absolute=negative?-value:value;return (negative?'-':'')+(absolute/100n).toString()+'.'+(absolute%100n).toString().padStart(2,'0');}
const nativeAmount=value=>{const number=Number(xeroMoney(value));xeroCheck(xeroCents(String(number),{signed:true,zero:true})===value,'XERO_AMOUNT_NOT_EXACT','The chosen value cannot be represented exactly by the native JSON amount.');return number;};
const sourceFile=(name,bytes)=>({name,bytes:Buffer.byteLength(bytes),sha256:xeroHash(bytes)});
const forbiddenSystems=new Set(['DEBTORS','CREDITORS','BANKCURRENCYGAIN','CURRENTYEAR','UNREALISEDCURRENCYGAIN','TRACKINGTRANSFERS']);
export function createXeroContext({id=randomUUID(),name,actor,createdAt=new Date().toISOString(),tenantId,organizationBytes,accountsBytes}={}){
  xeroId(id);xeroId(tenantId);xeroText(name,'Organization label',160);xeroText(actor,'Operator',1000);instant(createdAt);
  const source=xeroParse(organizationBytes,'Organization response'),accountsSource=xeroParse(accountsBytes,'Accounts response');
  xeroCheck(Array.isArray(source.Organisations)&&source.Organisations.length===1,'XERO_ORGANIZATION_REQUIRED','Import exactly one native Xero organization.');
  const native=source.Organisations[0];
  xeroCheck(object(native)&&typeof native.OrganisationID==='string'&&native.OrganisationID.toLowerCase()===tenantId&&native.OrganisationStatus==='ACTIVE'&&typeof native.IsDemoCompany==='boolean'&&/^[A-Z]{3}$/.test(native.BaseCurrency??''),'XERO_ORGANIZATION_MISMATCH','The active native organization, tenant, demo flag or base currency is missing or mismatched.');
  xeroText(native.Name,'Native organization name',255);
  xeroCheck(Array.isArray(accountsSource.Accounts)&&accountsSource.Accounts.length>0&&accountsSource.Accounts.length<=5000,'XERO_ACCOUNTS_REQUIRED','Import the native organization chart of accounts, up to 5,000 accounts.');
  const ids=new Set(),codes=new Set(),accounts=accountsSource.Accounts.map(account=>{
    xeroCheck(object(account)&&typeof account.AccountID==='string','INVALID_XERO_ACCOUNT','A native account has no account UUID.');
    const id=xeroId(account.AccountID.toLowerCase()),code=xeroText(account.Code??'','Native account code',10,{empty:true}),name=xeroText(account.Name,'Native account name',255);
    xeroCheck(!ids.has(id)&&(!code||!codes.has(code)),'DUPLICATE_XERO_ACCOUNT','The source chart repeats an account ID or code.');ids.add(id);if(code)codes.add(code);
    const type=xeroText(account.Type??'','Native account type',40,{empty:true}),systemAccount=xeroText(account.SystemAccount??'','Native system account',60,{empty:true}),status=xeroText(account.Status??'','Native account status',30,{empty:true});
    const eligible=status==='ACTIVE'&&Boolean(code)&&type!=='BANK'&&!forbiddenSystems.has(systemAccount);
    return {id,code,name,type,status,systemAccount,eligible};
  });
  xeroCheck(accounts.filter(account=>account.eligible).length>=2,'XERO_JOURNAL_ACCOUNTS_REQUIRED','Select an organization with at least two active accounts that support manual journals.');
  return seal({schema:XERO_CONTEXT_SCHEMA,id,name,actor,createdAt,tenantId,
    organization:{id:tenantId,name:native.Name,baseCurrency:native.BaseCurrency,isDemoCompany:native.IsDemoCompany,status:native.OrganisationStatus},
    accounts,source:[sourceFile('organization.json',organizationBytes),sourceFile('accounts.json',accountsBytes)],docs:XERO_DOCS});
}
export function validateXeroContext(context){verify(context,XERO_CONTEXT_SCHEMA);xeroId(context.id);xeroId(context.tenantId);xeroCheck(context.organization?.id===context.tenantId&&Array.isArray(context.accounts),'INVALID_XERO_CONTEXT','The retained organization or accounts are invalid.');return context;}
export function xeroSourceComponents(handoff,adjustmentsBytes){
  validateHandoff(handoff);const components=[],byEvent=new Map(),seen=new Set();
  for(const row of handoff.rows){const event=row.original,component={id:xeroHash('stellar-forge.xero-component.v1\n'+event.network+'\n'+event.eventId+'\nPAYMENT'),kind:'PAYMENT',rowId:row.rowId,sourceRowSha256:row.sourceRowSha256,eventId:event.eventId,network:event.network,sourceAt:event.at,amountAtomic:event.amountAtomic,assetDigest:event.assetDigest,assetLabel:row.label.assetLabel,unitLabel:row.label.unitLabel,transfer:event.transfer,transactionFingerprint:event.transactionFingerprint??null,adjustmentId:null};
    components.push(component);seen.add(component.id);byEvent.set(event.network+'\n'+event.eventId,row);
  }
  if(handoff.source.adjustments){
    xeroCheck(adjustmentsBytes&&xeroHash(adjustmentsBytes)===handoff.source.adjustments.sha256&&Buffer.byteLength(adjustmentsBytes)===handoff.source.adjustments.bytes,'XERO_ADJUSTMENTS_CHANGED','Use the exact adjustment snapshot frozen with the accountant handoff.',409);
    const snapshot=xeroParse(adjustmentsBytes,'Original adjustment snapshot');
    xeroCheck(snapshot.schema==='stellar-forge.merchant-adjustment-export.v1'&&Array.isArray(snapshot.events),'XERO_ADJUSTMENTS_REQUIRED','Use the original accountant adjustment export.');
    for(const event of snapshot.events){const row=byEvent.get(event.original?.network+'\n'+event.original?.eventId);xeroCheck(row&&xeroCanonical(event.original)===xeroCanonical(row.original),'XERO_ADJUSTMENT_EVENT_MISMATCH','An adjustment snapshot belongs to another original payment.',409);
      for(const adjustment of event.adjustments??[]){validateAdjustment(adjustment);if(adjustment.kind!=='REFUND'||adjustment.status!=='VERIFIED')continue;
        const proof=adjustment.verification.proof;
        const id=xeroHash('stellar-forge.xero-component.v1\n'+row.original.network+'\n'+row.eventId+'\nREFUND\n'+proof.transaction+'\n'+proof.matchingEventId);
        xeroCheck(!seen.has(id),'XERO_DUPLICATE_REFUND_SOURCE','The source snapshot repeats the same native refund transfer.',409);seen.add(id);
        components.push({id,kind:'REFUND',rowId:row.rowId,sourceRowSha256:row.sourceRowSha256,eventId:row.eventId,network:row.original.network,sourceAt:proof.transferAt??adjustment.effectiveAt,sourceTimeBasis:proof.transferAt?'NATIVE_REFUND_TRANSFER':'MERCHANT_EFFECTIVE_DATE',amountAtomic:adjustment.amountAtomic,assetDigest:row.original.assetDigest,assetLabel:row.label.assetLabel,unitLabel:row.label.unitLabel,transfer:proof.verdict,transactionFingerprint:proof.transaction,adjustmentId:adjustment.id,matchingEventId:proof.matchingEventId});
      }
    }
  }else xeroCheck(!adjustmentsBytes,'XERO_ADJUSTMENTS_NOT_FROZEN','The original handoff does not contain an adjustment snapshot.');
  return components;
}
export function createXeroPlan({id=randomUUID(),name,actor,createdAt=new Date().toISOString(),handoff,revision=null,context,adjustmentsBytes,entries,purpose,valuationBasis,showOnCashBasisReports=false}={}){
  xeroId(id);xeroText(name,'Journal plan name',160);xeroText(actor,'Operator',1000);instant(createdAt);validateHandoff(handoff);if(revision)validateRevision(handoff,revision);validateXeroContext(context);
  xeroCheck(['demo','books'].includes(purpose),'XERO_PURPOSE_REQUIRED','Choose the demo organization or merchant books purpose.');
  xeroCheck(purpose!=='demo'||context.organization.isDemoCompany,'XERO_DEMO_ORGANIZATION_REQUIRED','A demo plan requires a native Xero demo organization.');
  xeroCheck(purpose!=='books'||!context.organization.isDemoCompany,'XERO_BOOKS_ORGANIZATION_REQUIRED','Merchant books require a native organization whose demo flag is false.');
  xeroText(valuationBasis,'Valuation and tax treatment',2000,{multiline:true});xeroCheck(typeof showOnCashBasisReports==='boolean','XERO_CASH_BASIS_REQUIRED','Choose whether the drafts appear on cash basis reports.');
  const source=xeroSourceComponents(handoff,adjustmentsBytes),known=new Map(source.map(component=>[component.id,component])),seen=new Set(),accounts=new Map(context.accounts.filter(account=>account.eligible).map(account=>[account.code,account]));
  xeroCheck(Array.isArray(entries)&&entries.length===source.length,'XERO_COMPONENT_DECISIONS_REQUIRED','Choose include or exclude for every original payment and verified refund.');
  const included=[],excluded=[];
  for(const entry of entries){const component=known.get(entry.componentId);xeroCheck(object(entry)&&component&&!seen.has(entry.componentId),'INVALID_XERO_COMPONENT','A source component is unknown or repeated.');seen.add(entry.componentId);
    xeroCheck(['include','exclude'].includes(entry.decision),'XERO_COMPONENT_DECISION_REQUIRED','Choose include or exclude for each source component.');
    if(entry.decision==='exclude'){excluded.push({...component,decision:'exclude',reason:xeroText(entry.reason,'Exclusion reason',2000,{multiline:true})});continue;}
    xeroCheck(purpose!=='books'||component.network==='stellar:pubnet'&&(component.kind==='REFUND'||component.transfer==='OFFICIAL_TRANSFER_MATCHED'),'XERO_BOOKS_SOURCE_REQUIRED','Merchant books require each selected public-network payment or refund to have its original independently matched transfer.');
    const cents=xeroCents(entry.amount),date=xeroDate(entry.date),debit=accounts.get(entry.debitAccountCode),credit=accounts.get(entry.creditAccountCode);
    xeroCheck(debit&&credit&&debit.id!==credit.id,'XERO_ACCOUNTS_REQUIRED','Choose distinct active debit and credit accounts from the retained chart.');
    included.push({...component,decision:'include',date,amount:xeroMoney(cents),debitAccount:clone(debit),creditAccount:clone(credit),valuationNote:xeroText(entry.valuationNote,'Component valuation source',2000,{multiline:true}),description:xeroText(entry.description??component.kind+' '+component.eventId,'Line description',2000)});
  }
  xeroCheck(included.length>0,'XERO_EMPTY_PLAN','Include at least one explicitly valued source component.');
  const groups=new Map();for(const entry of included){const group=groups.get(entry.date)??[];group.push(entry);groups.set(entry.date,group);}
  const journals=[];
  for(const [date,group]of [...groups].sort(([a],[b])=>a.localeCompare(b))){for(let offset=0;offset<group.length;offset+=100){const batch=group.slice(offset,offset+100),index=journals.length,narration=name+' [SF:'+id+':'+index+']',lines=[];let total=0n;
      for(const entry of batch){const amount=xeroCents(entry.amount),description='SF:'+entry.id+' '+entry.kind+' · '+entry.description;total+=amount;lines.push({Description:description,LineAmount:nativeAmount(amount),AccountCode:entry.debitAccount.code,TaxType:'NONE'},{Description:description,LineAmount:nativeAmount(-amount),AccountCode:entry.creditAccount.code,TaxType:'NONE'});}
      xeroCheck(lines.reduce((sum,line)=>sum+xeroCents(String(line.LineAmount),{signed:true,zero:true}),0n)===0n,'XERO_JOURNAL_UNBALANCED','The exact debit and credit journal values do not balance.');
      const payload={Narration:narration,JournalLines:lines,Date:date,LineAmountTypes:'NoTax',Status:'DRAFT',ShowOnCashBasisReports:showOnCashBasisReports},journalId=xeroHash(id+'\n'+index+'\n'+xeroCanonical(payload));
      journals.push({id:journalId,index,date,narration,componentIds:batch.map(entry=>entry.id),debitTotal:xeroMoney(total),creditTotal:xeroMoney(total),payload,payloadSha256:xeroHash(xeroCanonical(payload)),idempotencyKey:'SF-'+journalId});
  }}
  const baseline=inspectHandoff(handoff,revision).rows.map(row=>({rowId:row.rowId,...Object.fromEntries(EDITABLE_COLUMNS.map(key=>[key,row[key]]))}));
  return seal({schema:XERO_PLAN_SCHEMA,id,name,actor,createdAt,purpose,valuationBasis,showOnCashBasisReports,
    source:{handoffId:handoff.id,handoffSha256:handoff.integrity.sha256,reportSha256:handoff.source.reportSha256,runId:handoff.source.runId,accountantRevisionId:revision?.id??null,periodClose:clone(handoff.source.periodClose??null),adjustmentsSha256:handoff.source.adjustments?.sha256??null},
    context:{id:context.id,sha256:context.sha256,tenantId:context.tenantId,organization:clone(context.organization)},baseline,entries:included,excluded,journals,
    summary:{includedComponents:included.length,excludedComponents:excluded.length,paymentComponents:included.filter(entry=>entry.kind==='PAYMENT').length,refundComponents:included.filter(entry=>entry.kind==='REFUND').length,journals:journals.length,baseCurrency:context.organization.baseCurrency,debits:xeroMoney(included.reduce((sum,entry)=>sum+xeroCents(entry.amount),0n)),credits:xeroMoney(included.reduce((sum,entry)=>sum+xeroCents(entry.amount),0n)),taxTreatment:'NoTax'},docs:XERO_DOCS});
}
export function validateXeroPlan(plan){verify(plan,XERO_PLAN_SCHEMA);xeroId(plan.id);xeroId(plan.context?.tenantId);xeroCheck(Array.isArray(plan.entries)&&Array.isArray(plan.journals)&&plan.journals.length>0,'INVALID_XERO_PLAN','The retained journal plan is incomplete.');return plan;}
export function xeroCreateRequest(plan,index){validateXeroPlan(plan);const journal=plan.journals[index];xeroCheck(journal,'XERO_JOURNAL_NOT_FOUND','Choose a journal from the retained plan.',404);return {method:'PUT',path:'ManualJournals?summarizeErrors=false',tenantId:plan.context.tenantId,idempotencyKey:journal.idempotencyKey,body:{ManualJournals:[clone(journal.payload)]}};}
function nativeDate(value){
  if(typeof value!=='string')return null;
  const ms=/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if(ms){const date=new Date(Number(ms[1]));return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):null;}
  try{return xeroDate(value.slice(0,10));}catch{return null;}
}
function lineKey(line){return xeroCanonical({code:line.AccountCode,amount:xeroCents(String(line.LineAmount),{signed:true,zero:true}).toString(),description:line.Description??''});}
export function compareXeroJournals({id=randomUUID(),plan,responseFiles,actor,createdAt=new Date().toISOString(),source={kind:'operator-file'}}={}){
  xeroId(id);validateXeroPlan(plan);xeroText(actor,'Operator',1000);instant(createdAt);
  xeroCheck(Array.isArray(responseFiles)&&responseFiles.length>0&&responseFiles.length<=1000,'XERO_RESPONSES_REQUIRED','Choose the original ManualJournals response files.');
  let totalBytes=0;const documents=[],nativeRows=[],files=[];
  for(const [index,file]of responseFiles.entries()){const bytes=Buffer.from(file.bytes);totalBytes+=bytes.length;xeroCheck(totalBytes<=128_000_000,'XERO_RESPONSES_TOO_LARGE','Use at most 128 MB of original native responses in one comparison.');
    const document=xeroParse(bytes,'ManualJournals response');xeroCheck(Array.isArray(document.ManualJournals)&&document.ManualJournals.length<=10_000,'XERO_MANUAL_JOURNALS_REQUIRED','Use a native ManualJournals response with its original journal array.');
    files.push(sourceFile(file.name??'response-'+index+'.json',bytes));documents.push(document);for(const row of document.ManualJournals)nativeRows.push(row);
  }
  const allowedNarrations=new Set(plan.journals.map(journal=>journal.narration));
  const unassigned=nativeRows.filter(row=>!allowedNarrations.has(row.Narration)).map(row=>({journalId:row.ManualJournalID??null,narration:row.Narration??null}));
  const journals=plan.journals.map(expected=>{
    const candidates=nativeRows.filter(row=>row.Narration===expected.narration),byId=new Map(),issues=[];
    for(const native of candidates){const identity=String(native.ManualJournalID??'').toLowerCase();if(!UUID.test(identity)){issues.push('Native journal ID is missing or invalid.');continue;}const key=xeroCanonical(native);const versions=byId.get(identity)??new Map();versions.set(key,native);byId.set(identity,versions);}
    if(byId.size===0)return {index:expected.index,narration:expected.narration,status:issues.length?'MISMATCH':'MISSING',journalId:null,issues,nativeStatus:null};
    if(byId.size!==1||[...byId.values()].some(versions=>versions.size!==1))return {index:expected.index,narration:expected.narration,status:'DUPLICATE',journalId:null,nativeStatus:null,issues:['The source contains multiple IDs or differing versions for this plan narration.']};
    const [journalId,versions]=[...byId][0],native=[...versions.values()][0],payload=expected.payload;
    if(nativeDate(native.DateString??native.Date)!==payload.Date)issues.push('Journal date differs.');
    if(native.LineAmountTypes!==payload.LineAmountTypes)issues.push('Line amount tax treatment differs.');
    if((native.ShowOnCashBasisReports??true)!==payload.ShowOnCashBasisReports)issues.push('Cash basis report treatment differs.');
    if(!['DRAFT','POSTED','DELETED','VOIDED','ARCHIVED'].includes(native.Status))issues.push('Native status is unsupported.');
    if(native.HasErrors||native.ValidationErrors?.length)issues.push('Native journal contains validation errors.');
    if(!Array.isArray(native.JournalLines)||native.JournalLines.length!==payload.JournalLines.length)issues.push('Journal line count differs.');
    else{
      const expectedLines=new Map();for(const line of payload.JournalLines){const key=lineKey(line);expectedLines.set(key,(expectedLines.get(key)??0)+1);}
      for(const line of native.JournalLines){try{const key=lineKey(line),remaining=expectedLines.get(key)??0;if(!remaining)issues.push('A native line differs in account, description or exact amount.');else expectedLines.set(key,remaining-1);
          if(line.TaxAmount!==undefined&&xeroCents(String(line.TaxAmount),{signed:true,zero:true})!==0n)issues.push('A native line adds tax.');
          if(line.TaxType!==undefined&&line.TaxType!=='NONE')issues.push('A native line changes tax type.');
          if(line.Tracking?.length)issues.push('A native line adds tracking categories.');
          if(line.AccountID!==undefined){const accounts=plan.entries.flatMap(entry=>[entry.debitAccount,entry.creditAccount]);const account=accounts.find(account=>account.code===line.AccountCode);if(!account||String(line.AccountID).toLowerCase()!==account.id)issues.push('Native account ID differs from the retained account code.');}
        }catch{issues.push('A native line has an invalid exact decimal amount.');}}
      if([...expectedLines.values()].some(count=>count!==0))issues.push('Expected debit or credit lines are missing.');
    }
    return {index:expected.index,narration:expected.narration,status:issues.length?'MISMATCH':'MATCHED',journalId,nativeStatus:native.Status,issues:[...new Set(issues)],warnings:clone(native.Warnings??[]),native:clone(native)};
  });
  return seal({schema:XERO_CAPTURE_SCHEMA,id,actor,createdAt,planId:plan.id,planSha256:plan.sha256,tenantId:plan.context.tenantId,source:clone(source),files,journals,unassigned,
    summary:{matched:journals.filter(row=>row.status==='MATCHED').length,missing:journals.filter(row=>row.status==='MISSING').length,mismatched:journals.filter(row=>row.status==='MISMATCH').length,duplicate:journals.filter(row=>row.status==='DUPLICATE').length,posted:journals.filter(row=>row.status==='MATCHED'&&row.nativeStatus==='POSTED').length,draft:journals.filter(row=>row.status==='MATCHED'&&row.nativeStatus==='DRAFT').length,unassigned:unassigned.length}});
}
const editable=row=>Object.fromEntries(EDITABLE_COLUMNS.map(key=>[key,row[key]]));
const quoteRaw=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const encodeEditable=value=>/^['\t\r\n]/.test(value)||/^\s*[=+\-@]/u.test(value)||/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(value)&&value.replace(/\D/g,'').length>15?"'"+value:value;
export function prepareXeroReturn({plan,capture,handoff,revision=null,previousAssignments=[]}={}){
  validateXeroPlan(plan);verify(capture,XERO_CAPTURE_SCHEMA);validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
  xeroCheck(capture.planId===plan.id&&capture.planSha256===plan.sha256&&handoff.id===plan.source.handoffId&&handoff.integrity.sha256===plan.source.handoffSha256,'XERO_RETURN_SOURCE_MISMATCH','Use this plan’s original handoff and retained comparison.',409);
  const current=new Map(inspectHandoff(handoff,revision).rows.map(row=>[row.rowId,row])),baseline=new Map(plan.baseline.map(row=>[row.rowId,row])),previous=new Map(previousAssignments.map(row=>[row.rowId,row])),byRow=new Map(),matches=new Map(capture.journals.map(row=>[row.index,row]));
  for(const entry of plan.entries){const items=byRow.get(entry.rowId)??[];items.push(entry);byRow.set(entry.rowId,items);}
  const proposed=new Map(),conflicts=[],skipped=[];
  for(const [rowId,entries]of byRow){const journals=plan.journals.filter(journal=>journal.componentIds.some(id=>entries.some(entry=>entry.id===id))),native=journals.map(journal=>matches.get(journal.index));
    if(native.some(row=>!row||row.status!=='MATCHED'||!['DRAFT','POSTED'].includes(row.nativeStatus))){skipped.push({rowId,reason:'Each selected component needs an exact active native journal match.'});continue;}
    const base=baseline.get(rowId),now=current.get(rowId),prior=previous.get(rowId),values=editable(base),payment=entries.find(entry=>entry.kind==='PAYMENT'),references=[...new Set(native.map(row=>row.journalId))],posted=native.every(row=>row.nativeStatus==='POSTED');
    if(payment){const journal=plan.journals.find(journal=>journal.componentIds.includes(payment.id)),matched=matches.get(journal.index);values.externalStatus=posted&&plan.purpose==='books'?'BOOKED':'REVIEWED';values.externalBookRef='xero:'+matched.journalId;values.externalAccountCode=payment.creditAccount.code;}
    const note='[Xero plan '+plan.id+'] '+plan.context.organization.name+' ('+plan.context.organization.baseCurrency+', '+plan.purpose+'); '+(posted?'posted':'draft')+' journals: '+references.join(', ')+'.';
    values.externalNote=(base.externalNote?base.externalNote+'\n':'')+note;
    if(values.externalNote.length>4000){skipped.push({rowId,reason:'The combined original note and native journal references exceed the accountant note limit.'});continue;}
    const changed=EDITABLE_COLUMNS.filter(key=>now[key]!==base[key]&&now[key]!==values[key]&&(!prior||now[key]!==prior[key]));
    if(changed.length){conflicts.push({rowId,fields:changed,current:editable(now),planBaseline:editable(base),previousXeroReturn:prior?editable(prior):null,proposed:values});continue;}
    proposed.set(rowId,values);
  }
  const parsed=parseReturnCsv(renderCsv(handoff,revision),{columns:accountantColumns(handoff)}),lines=[parsed.headers.map(quoteRaw).join(',')];
  for(const [rowNumber,row]of parsed.records.entries()){const values=proposed.get(handoff.rows[rowNumber].rowId);if(!values)continue;const output=[...row.values];for(const key of EDITABLE_COLUMNS)output[parsed.headers.indexOf(key)]=encodeEditable(values[key]);lines.push(output.map(quoteRaw).join(','));}
  return {csvBytes:Buffer.from(lines.join('\r\n')+'\r\n'),conflicts,skipped,matchedRows:proposed.size,assignments:[...proposed].map(([rowId,values])=>({rowId,...values}))};
}
const html=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderXeroReview(plan,capture){
  validateXeroPlan(plan);
  const rows=plan.entries.map(entry=>'<tr><td>'+html(entry.kind)+'<br><small>'+html(entry.eventId)+'</small></td><td>'+html(entry.amountAtomic)+'<br>'+html(entry.assetLabel||entry.assetDigest)+'</td><td>'+html(entry.date)+'</td><td>'+html(entry.amount)+' '+html(plan.context.organization.baseCurrency)+'</td><td>'+html(entry.debitAccount.code)+' / '+html(entry.creditAccount.code)+'</td><td>'+html(entry.valuationNote)+'</td></tr>').join('');
  const body='<h1>'+html(plan.name)+'</h1><p>'+html(plan.context.organization.name)+' · '+html(plan.context.organization.baseCurrency)+' · '+html(plan.purpose)+'</p><p>'+html(plan.valuationBasis)+'</p><p>Original handoff '+html(plan.source.handoffId)+'<br>Plan '+html(plan.id)+'<br>Source report '+html(plan.source.reportSha256)+'</p><table><thead><tr><th>Original component</th><th>Native amount and asset</th><th>Journal date</th><th>Base-currency value</th><th>Debit / credit</th><th>Valuation source</th></tr></thead><tbody>'+rows+'</tbody></table><h2>Exact draft journals</h2><pre>'+html(JSON.stringify(plan.journals,null,2))+'</pre><h2>Explicit exclusions</h2><pre>'+html(JSON.stringify(plan.excluded,null,2))+'</pre>'+(capture?'<h2>Retained native comparison</h2><pre>'+html(JSON.stringify(capture,null,2))+'</pre>':'');
  return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html(plan.name)+'</title><style>body{font:15px system-ui;color:#202428;background:#fff;max-width:1500px;margin:auto;padding:30px}p{line-height:1.6}table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #c7ccd0;padding:10px;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f3f4;padding:16px}small{font-size:11px}</style><main>'+body+'</main></html>');
}
