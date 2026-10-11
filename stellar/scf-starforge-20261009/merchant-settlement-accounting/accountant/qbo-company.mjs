// MIT. Native QuickBooks company/settings/account imports for the original accountant workspace.
import {createHash} from 'node:crypto';

export const QBO_COMPANY_SCHEMA='stellar-forge.quickbooks-company.v1';
export const QBO_COMPANY_CURRENCIES=Object.freeze(['USD','CAD','EUR','GBP','AUD','NZD']);
const MAX_SOURCE_BYTES=8*1024*1024;
const ACCOUNT_TYPES=new Set(['Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset',
  'Accounts Payable','Credit Card','Other Current Liability','Long Term Liability','Equity','Income',
  'Cost of Goods Sold','Expense','Other Income','Other Expense','Non-Posting']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const text=(value,label,max=1000)=>{
  check(typeof value==='string'&&value.length<=max&&value.trim().length>0&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'QBO_COMPANY_FIELD','Use the original '+label+'.');
  return value;
};
const target=(value,label)=>{
  check(typeof value==='string'&&/^[0-9]{1,64}$/.test(value),'QBO_COMPANY_REFERENCE',
    'Use the exact '+label+' as a numeric string.');
  return value;
};
const currency=(value,label)=>{
  check(typeof value==='string'&&/^[A-Z]{3}$/.test(value),'QBO_COMPANY_CURRENCY',
    'Use the original three-letter '+label+'.');
  return value;
};
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){
    check(Number.isFinite(value),'QBO_COMPANY_SOURCE_JSON','Source numbers must be finite.');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  check(object(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),
    'QBO_COMPANY_SOURCE_JSON','Use native JSON source records.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
function readSource(value,label){
  let bytes,sourceText,document;
  if(typeof value==='string'){
    bytes=Buffer.from(value,'utf8');
    sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    check(sourceText===value,'QBO_COMPANY_SOURCE_UTF8','The '+label+' source must be valid UTF-8 JSON.');
  }else if(Buffer.isBuffer(value)||value instanceof Uint8Array){
    bytes=Buffer.from(value);
    try{sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
    catch{throw Object.assign(new Error('The '+label+' source must be valid UTF-8 JSON.'),{code:'QBO_COMPANY_SOURCE_UTF8',status:400});}
  }else{
    check(object(value)||Array.isArray(value),'QBO_COMPANY_SOURCE_REQUIRED','Import the original '+label+' JSON.');
    sourceText=canonical(value);
    bytes=Buffer.from(sourceText,'utf8');
  }
  check(bytes.length>0&&bytes.length<=MAX_SOURCE_BYTES,'QBO_COMPANY_SOURCE_SIZE',
    'Each company source must be nonempty and at most 8 MiB.');
  try{document=JSON.parse(sourceText.startsWith('\uFEFF')?sourceText.slice(1):sourceText);}
  catch{throw Object.assign(new Error('The '+label+' source must be valid JSON.'),{code:'QBO_COMPANY_SOURCE_JSON',status:400});}
  check(object(document)||Array.isArray(document),'QBO_COMPANY_SOURCE_JSON','Import a native '+label+' JSON object or account-page array.');
  return {document,sourceText,digest:{sha256:hash(bytes),canonicalSha256:hash(canonical(document)),bytes:bytes.length}};
}
function checkSourceEnvelope(document,realmId,label){
  if(!object(document))return;
  check(!Object.hasOwn(document,'Fault'),'QBO_COMPANY_SOURCE_FAULT',
    'QuickBooks returned a Fault for '+label+'. Import its successful original response.');
  if(document.realmId!==undefined)check(document.realmId===realmId,'QBO_COMPANY_REALM',
    'The '+label+' source names a different QuickBooks company.',409);
}
function entity(document,key,realmId){
  check(object(document),'QBO_COMPANY_SOURCE_SHAPE','Import the native '+key+' object.');
  checkSourceEnvelope(document,realmId,key);
  let result;
  if(Object.hasOwn(document,'QueryResponse')){
    check(object(document.QueryResponse),'QBO_COMPANY_SOURCE_SHAPE','Import one native '+key+' query result.');
    checkSourceEnvelope(document.QueryResponse,realmId,key);
    const matches=document.QueryResponse[key];
    check(Array.isArray(matches)&&matches.length===1,'QBO_COMPANY_SOURCE_SHAPE','The '+key+' query must contain exactly one entity.');
    result=matches[0];
  }else result=Object.hasOwn(document,key)?document[key]:document;
  check(object(result),'QBO_COMPANY_SOURCE_SHAPE','Import exactly one native '+key+' object.');
  checkSourceEnvelope(result,realmId,key);
  if(result.domain!==undefined)check(result.domain==='QBO','QBO_COMPANY_SOURCE_DOMAIN',
    'The '+key+' source must come from QuickBooks Online.');
  return result;
}
function extractAccounts(document,realmId){
  const records=[];
  let pageCount=0;
  const append=page=>{
    check(object(page),'QBO_COMPANY_ACCOUNT_SOURCE','Import native Account records or Account query pages.');
    checkSourceEnvelope(page,realmId,'accounts');
    if(Object.hasOwn(page,'QueryResponse')){
      const query=page.QueryResponse;
      check(object(query),'QBO_COMPANY_ACCOUNT_SOURCE','The Account QueryResponse must be an object.');
      checkSourceEnvelope(query,realmId,'accounts');
      const rows=query.Account??[];
      check(Array.isArray(rows),'QBO_COMPANY_ACCOUNT_SOURCE','QueryResponse.Account must be an array.');
      for(const row of rows)records.push(row);pageCount++;
    }else if(Object.hasOwn(page,'Account')){
      check(object(page.Account),'QBO_COMPANY_ACCOUNT_SOURCE','An Account read response must contain one Account object.');
      records.push(page.Account);pageCount++;
    }else{
      check(Object.hasOwn(page,'Id'),'QBO_COMPANY_ACCOUNT_SOURCE','Import the native Account Id and fields.');
      records.push(page);
    }
  };
  if(Array.isArray(document)){
    check(document.length>0,'QBO_COMPANY_ACCOUNTS_EMPTY','Import at least one original Account record.');
    document.forEach(append);
    if(pageCount===0)pageCount=1;
  }else{append(document);if(pageCount===0)pageCount=1;}
  check(records.length>0,'QBO_COMPANY_ACCOUNTS_EMPTY','The imported source contains no Account records.');
  return {records,pageCount};
}
function normalizeAccount(record,baseCurrency,seen,realmId){
  check(object(record),'QBO_COMPANY_ACCOUNT_SOURCE','Each Account must be a native JSON object.');
  if(record.domain!==undefined)check(record.domain==='QBO','QBO_COMPANY_SOURCE_DOMAIN','Account source must come from QuickBooks Online.');
  const value=target(record.Id,'QuickBooks Account.Id');
  checkSourceEnvelope(record,realmId,'Account '+value);
  check(!seen.has(value),'QBO_COMPANY_ACCOUNT_DUPLICATE','Account '+value+' occurs more than once. Import one consistent chart selection.',409);
  seen.add(value);
  check(typeof record.Active==='boolean','QBO_COMPANY_ACCOUNT_ACTIVE',
    'Account '+value+' must include its actual boolean Active field.');
  const name=text(record.FullyQualifiedName??record.Name,'account name');
  const AccountType=text(record.AccountType,'account type',100);
  let CurrencyRef=null;
  if(record.CurrencyRef!==undefined&&record.CurrencyRef!==null){
    check(object(record.CurrencyRef),'QBO_COMPANY_ACCOUNT_CURRENCY','Account '+value+' CurrencyRef must be a native reference.');
    CurrencyRef={value:currency(record.CurrencyRef.value,'account currency')};
    if(record.CurrencyRef.name!==undefined)CurrencyRef.name=text(record.CurrencyRef.name,'currency name',200);
  }
  const reasons=[];
  const reason=(code,message)=>reasons.push({code,message});
  if(!record.Active)reason('INACTIVE','This QuickBooks account is inactive.');
  if(!ACCOUNT_TYPES.has(AccountType))reason('UNSUPPORTED_ACCOUNT_TYPE','The imported AccountType is outside the supported native account types.');
  if(AccountType==='Non-Posting')reason('NON_POSTING','QuickBooks Online journals require a posting account.');
  if(['Accounts Receivable','Accounts Payable'].includes(AccountType))reason('COUNTERPARTY_REQUIRED',
    'This account needs a customer or vendor mapping outside the current settlement-journal profile.');
  if(!QBO_COMPANY_CURRENCIES.includes(baseCurrency))reason('UNSUPPORTED_HOME_CURRENCY',
    'The current journal profile supports USD, CAD, EUR, GBP, AUD and NZD.');
  if(!CurrencyRef)reason('ACCOUNT_CURRENCY_REQUIRED','Import this account’s actual CurrencyRef or use an independently verified manual mapping.');
  else if(CurrencyRef.value!==baseCurrency)reason('FOREIGN_ACCOUNT',
    'This account holds '+CurrencyRef.value+'; the reviewed journal uses '+baseCurrency+'.');
  return {value,name,Active:record.Active,AccountType,CurrencyRef,selectable:reasons.length===0,reasons};
}

/**
 * Imports exact native CompanyInfo, Preferences and Account JSON into a retained mapping source.
 * Account inputs can be direct records, one QueryResponse, or an array of original query pages.
 * The explicit realm is required because native entity responses do not establish it consistently.
 */
export function normalizeQboCompany({realmId,companyInfo,preferences,accounts}={}){
  target(realmId,'QuickBooks company realm ID');
  const originals={
    companyInfo:readSource(companyInfo,'CompanyInfo'),
    preferences:readSource(preferences,'Preferences'),
    accounts:readSource(accounts,'Account')
  };
  check(Object.values(originals).reduce((sum,source)=>sum+source.digest.bytes,0)<=MAX_SOURCE_BYTES,
    'QBO_COMPANY_SOURCE_SIZE','The combined original company sources must be at most 8 MiB.');
  const company=entity(originals.companyInfo.document,'CompanyInfo',realmId);
  const prefs=entity(originals.preferences.document,'Preferences',realmId);
  const companyName=text(typeof company.CompanyName==='string'&&company.CompanyName.trim()?company.CompanyName:company.LegalName,'company name',200);
  check(object(prefs.CurrencyPrefs),'QBO_COMPANY_PREFERENCES','Preferences must include the original CurrencyPrefs.');
  check(typeof prefs.CurrencyPrefs.MultiCurrencyEnabled==='boolean','QBO_COMPANY_PREFERENCES',
    'CurrencyPrefs must include the actual boolean MultiCurrencyEnabled field.');
  check(object(prefs.CurrencyPrefs.HomeCurrency),'QBO_COMPANY_PREFERENCES',
    'CurrencyPrefs must include HomeCurrency.value.');
  const baseCurrency=currency(prefs.CurrencyPrefs.HomeCurrency.value,'home currency');
  const parsed=extractAccounts(originals.accounts.document,realmId),seen=new Set();
  const normalizedAccounts=parsed.records.map(record=>normalizeAccount(record,baseCurrency,seen,realmId));
  const body={schema:QBO_COMPANY_SCHEMA,realmId,companyName,baseCurrency,
    multiCurrencyEnabled:prefs.CurrencyPrefs.MultiCurrencyEnabled,accounts:normalizedAccounts,
    summary:{accountCount:normalizedAccounts.length,selectableAccountCount:normalizedAccounts.filter(row=>row.selectable).length,pageCount:parsed.pageCount},
    sourceDocuments:Object.fromEntries(Object.entries(originals).map(([key,source])=>[key,source.sourceText])),
    sourceDigests:Object.fromEntries(Object.entries(originals).map(([key,source])=>[key,source.digest]))};
  return {...body,integrity:{sha256:hash(canonical(body))}};
}

/** Rebuild eligibility from the retained native sources instead of trusting edited selection flags. */
export function validateQboCompany(snapshot){
  check(object(snapshot)&&snapshot.schema===QBO_COMPANY_SCHEMA&&object(snapshot.integrity),
    'QBO_COMPANY_SNAPSHOT','Choose a retained QuickBooks company snapshot.');
  const {integrity,...body}=snapshot;
  check(typeof integrity.sha256==='string'&&/^[a-f0-9]{64}$/.test(integrity.sha256)&&hash(canonical(body))===integrity.sha256,
    'QBO_COMPANY_CHANGED','The retained QuickBooks company snapshot changed.',409);
  check(object(snapshot.sourceDocuments),'QBO_COMPANY_SNAPSHOT','The company snapshot needs its original source documents.');
  const rebuilt=normalizeQboCompany({realmId:snapshot.realmId,companyInfo:snapshot.sourceDocuments.companyInfo,
    preferences:snapshot.sourceDocuments.preferences,accounts:snapshot.sourceDocuments.accounts});
  check(canonical(rebuilt)===canonical(snapshot),'QBO_COMPANY_CHANGED',
    'The retained company/account mappings differ from their original QuickBooks sources.',409);
  return snapshot;
}

