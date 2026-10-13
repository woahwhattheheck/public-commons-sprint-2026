// MIT. Waterford's six-column alternative CSV, from complete original export files.
import hashes from '../../host/connected_sha256.cjs';
export const WATERFORD_COLUMNS=Object.freeze(['Receipt Date','Name','G/L Account','Receipt#','Total Amount','Payment Method']);
const copy=x=>JSON.parse(JSON.stringify(x));
const need=(x,m)=>{if(!x)throw new TypeError(m);};
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const identity=text=>hashes.sha256Utf8(text);
const cell=value=>{const s=String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export const writeMunicipalCsv=rows=>rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';

/** Strict RFC4180-style records; quoted newlines retain physical source locations. */
export function readMunicipalCsv(text,label='CSV'){
 need(typeof text==='string','Supply complete UTF-8 '+label+' text.');
 const original=text;
 if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
 const records=[],errors=[];let row=[],field='',line=1,start=1,quoted=false,closed=false,touched=false;
 const fail=(code,message)=>errors.push({source:label,line,record:records.length+1,code,message});
 const finishField=()=>{row.push(field);field='';closed=false;};
 const finishRow=()=>{finishField();records.push({record:records.length+1,line:start,values:row});row=[];touched=false;start=line+1;};
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='\0'){fail('CSV_NUL','NUL is not a valid export field.');return {records,errors,identity:identity(original)};}
  if(quoted){
   if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}
   else{field+=ch;if(ch==='\n'||(ch==='\r'&&text[i+1]!=='\n'))line++;}
   continue;
  }
  if(closed&&ch!==','&&ch!=='\r'&&ch!=='\n'){fail('CSV_AFTER_QUOTE','Only a delimiter or newline may follow a closing quote.');return {records,errors,identity:identity(original)};}
  if(ch==='"'){if(field.length||closed){fail('CSV_QUOTE','A quoted field must begin at the start of a field.');return {records,errors,identity:identity(original)};}quoted=true;touched=true;}
  else if(ch===','){finishField();touched=true;}
  else if(ch==='\r'||ch==='\n'){finishRow();if(ch==='\r'&&text[i+1]==='\n')i++;line++;start=line;}
  else{field+=ch;touched=true;}
 }
 if(quoted)fail('CSV_UNCLOSED_QUOTE','The complete export ends inside a quoted field.');
 else if(touched||row.length||field.length||closed){finishField();records.push({record:records.length+1,line:start,values:row});}
 if(!records.length)errors.push({source:label,line:1,record:1,code:'CSV_HEADER',message:'Supply the original header row.'});
 return {records,errors,identity:identity(original)};
}
function table(text,label,required){
 const parsed=readMunicipalCsv(text,label),errors=[...parsed.errors],headers=parsed.records[0]?.values||[];
 const positions=new Map();
 headers.forEach((h,i)=>{if(!nonempty(h)||positions.has(h))errors.push({source:label,line:1,record:1,code:'CSV_HEADER',message:'Headers must be nonempty and unique: '+h});positions.set(h,i);});
 for(const h of required)if(!positions.has(h))errors.push({source:label,line:1,record:1,code:'CSV_HEADER',message:'Missing mapped header: '+h});
 const rows=parsed.records.slice(1).map(r=>{
  if(r.values.length!==headers.length)errors.push({source:label,line:r.line,record:r.record,code:'CSV_WIDTH',message:'Expected '+headers.length+' fields; received '+r.values.length+'.'});
  return {...r,get:h=>r.values[positions.get(h)]??''};
 });
 return {headers,rows,errors,identity:parsed.identity};
}
function dateOnly(s){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)return null;
 const y=+m[1],mo=+m[2],d=+m[3],leap=y%4===0&&(y%100!==0||y%400===0);
 return y>=1000&&mo>=1&&mo<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]?s:null;
}
function receiptDate(value,format){
 if(format==='yyyy-mm-dd')return dateOnly(value);
 if(format==='mm/dd/yyyy'){
  const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return m?dateOnly(m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')):null;
 }
 if(format==='iso8601'){
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!m||+m[2]>23||+m[3]>59||+(m[4]||0)>59||+(m[6]||0)>14||+(m[7]||0)>59||(+m[6]===14&&+m[7]!==0))return null;
  return dateOnly(m[1]); // Deliberately use the declared source-local calendar date.
 }
 return null;
}
function cents(value,format){
 let s=value.trim(),negative=false;
 if(format==='usd'){
  if(s.startsWith('(')&&s.endsWith(')')){negative=true;s=s.slice(1,-1);}
  if(s.startsWith('-')){if(negative)return null;negative=true;s=s.slice(1);}
  else if(s.startsWith('+'))s=s.slice(1);
  if(s.startsWith('$'))s=s.slice(1);
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))return null;
  s=s.replaceAll(',','');
 }else{
  if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s))return null;
  if(s[0]==='-'){negative=true;s=s.slice(1);}else if(s[0]==='+')s=s.slice(1);
 }
 const [whole,fraction='']=s.split('.');const valueCents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 return negative?-valueCents:valueCents;
}
function signedAmount(amount,kind,sign){
 if(amount===null)return null;
 if(sign==='positive'&&amount<0n)return null;
 if(sign==='negative'&&amount>0n)return null;
 if(kind==='payment')return amount>=0n?amount:null;
 if(kind==='refund')return sign==='positive'?-amount:amount<=0n?amount:null;
 return amount;
}
const money=n=>(n<0n?'-':'')+(n<0n?-n:n)/100n+'.'+String((n<0n?-n:n)%100n).padStart(2,'0');
function mappingDefinition(value){
 need(plain(value)&&value.schema==='waterford.municipal-csv-mapping.v1','Use the complete waterford.municipal-csv-mapping.v1 mapping.');
 const m=copy(value);
 need(nonempty(m.version),'Name the reviewed mapping version.');
 for(const name of ['accounts','transactions','receipt','date','money','gl','payment','status'])need(plain(m[name]),'Supply '+name+' mapping.');
 need(nonempty(m.accounts.key)&&Array.isArray(m.accounts.name_fields)&&m.accounts.name_fields.length&&m.accounts.name_fields.every(nonempty),'Select the account key and complete name fields.');
 need(nonempty(m.accounts.name_policy),'Describe whose name the receipt uses.');
 m.accounts.name_separator=m.accounts.name_separator??' ';need(typeof m.accounts.name_separator==='string','Use a text name separator.');
 need(Array.isArray(m.transactions.key_fields)&&m.transactions.key_fields.length&&m.transactions.key_fields.every(nonempty),'Select stable transaction key fields.');
 need(nonempty(m.transactions.account_id),'Select the transaction account key.');
 need(['transaction','allocated-items'].includes(m.money.basis)&&['decimal','usd'].includes(m.money.format),'Select transaction or allocated-items and decimal or usd money format.');
 need(m.money.currency==='USD'&&nonempty(m.money.amount_field),'Select USD and the exact amount field.');
 if(m.money.basis==='allocated-items')need(nonempty(m.money.transaction_total_field)&&Array.isArray(m.money.item_key_fields)&&m.money.item_key_fields.length&&m.money.item_key_fields.every(nonempty)&&['transaction-magnitude','signed-ledger'].includes(m.money.item_sign),'Allocated items need an original gross transaction total, stable item keys and explicit transaction-magnitude or signed-ledger item signs.');
 need(nonempty(m.receipt.meaning),'Record the authoritative business meaning of Receipt#.');
 need(Boolean(nonempty(m.receipt.field))!==Boolean(plain(m.receipt.by_transaction)),'Select one receipt field or explicit transaction-key receipt map.');
 if(m.receipt.by_transaction)need(Object.values(m.receipt.by_transaction).every(nonempty),'Every explicit receipt mapping must be nonempty.');
 need(nonempty(m.date.field)&&['yyyy-mm-dd','mm/dd/yyyy','iso8601'].includes(m.date.format),'Select the original posted field and a supported explicit date format.');
 need(nonempty(m.date.time_basis)&&m.date.selection==='source-calendar-date','State the source time basis and select source-calendar-date.');
 for(const k of ['from','to'])if(m.date[k]!==undefined&&m.date[k]!=='')need(typeof m.date[k]==='string'&&dateOnly(m.date[k]),'Use YYYY-MM-DD for '+k+'.');
 need(!m.date.from||!m.date.to||m.date.from<=m.date.to,'Keep the date range in ascending order.');
 need(Array.isArray(m.gl.fields)&&m.gl.fields.length&&m.gl.fields.every(nonempty)&&Array.isArray(m.gl.rules)&&m.gl.rules.length,'Supply exact GL source fields and rules.');
 const glKeys=new Set();for(const rule of m.gl.rules){
  need(plain(rule)&&Array.isArray(rule.values)&&rule.values.length===m.gl.fields.length&&rule.values.every(x=>typeof x==='string')&&nonempty(rule.account),'Supply complete exact GL tuples and accounts.');
  const k=JSON.stringify(rule.values);need(!glKeys.has(k),'Keep one GL rule per exact source tuple.');glKeys.add(k);
 }
 need(nonempty(m.payment.field)&&plain(m.payment.map)&&Object.values(m.payment.map).every(nonempty),'Map original payment values to reviewed output codes.');
 need(nonempty(m.status.field)&&plain(m.status.map)&&Object.keys(m.status.map).length,'Select an explicit status field and semantics.');
 for(const [key,rule] of Object.entries(m.status.map)){
  need(plain(rule)&&['payment','refund','void','pending','exclude'].includes(rule.kind)&&nonempty(rule.meaning),'Define status semantics for '+key+'.');
  if(['payment','refund'].includes(rule.kind))need(['positive','negative','signed'].includes(rule.amount_sign),'Define source amount sign for '+key+'.');
  if(rule.kind==='payment')need(rule.amount_sign!=='negative','Payments use positive or signed nonnegative source values.');
 }
 return m;
}
/**
 * Pure preparation. The report retains every parsed row and disposition; source CSVs
 * and reviewed mapping are returned intact. Exceptions never enter the output CSV.
 */
export function prepareWaterfordCsv({accountsCsv,transactionsCsv,mapping}={}){
 const m=mappingDefinition(mapping),requiredTx=[...m.transactions.key_fields,m.transactions.account_id,m.date.field,m.money.amount_field,...m.gl.fields,m.payment.field,m.status.field];
 if(m.receipt.field)requiredTx.push(m.receipt.field);
 if(m.money.basis==='allocated-items')requiredTx.push(m.money.transaction_total_field,...m.money.item_key_fields);
 const accounts=table(accountsCsv,'accounts.csv',[m.accounts.key,...m.accounts.name_fields]),transactions=table(transactionsCsv,'transactions.csv',[...new Set(requiredTx)]);
 const globalErrors=[...accounts.errors,...transactions.errors],accountMap=new Map(),accountIssues=[];
 for(const row of accounts.rows){
  const key=row.get(m.accounts.key);if(!nonempty(key)){accountIssues.push({record:row.record,line:row.line,code:'ACCOUNT_KEY',values:row.values});continue;}
  const found=accountMap.get(key)||[];found.push(row);accountMap.set(key,found);
 }
 for(const [id,rows] of accountMap)if(rows.length>1)accountIssues.push({account_id:id,code:'AMBIGUOUS_ACCOUNT',records:rows.map(r=>r.record)});
 const grouped=new Map();
 if(!globalErrors.length)for(const row of transactions.rows){
  const values=m.transactions.key_fields.map(h=>row.get(h)),valid=values.every(nonempty);
  const key=valid?JSON.stringify(values):'missing-key-record-'+row.record;
  const group=grouped.get(key)||{key,key_values:values,rows:[]};group.rows.push(row);grouped.set(key,group);
 }
 const output=[],groups=[],byDate=new Map(),byGl=new Map(),byPayment=new Map();
 let included=0n,excluded=0n,exceptionKnown=0n,payments=0n,refunds=0n;
 const add=(map,key,value)=>map.set(key,(map.get(key)||0n)+value);
 for(const group of grouped.values()){
  const r=group.rows[0],problems=[],problem=(code,message)=>problems.push({code,message});
  const same=field=>group.rows.every(x=>x.get(field)===r.get(field));
  const g={transaction_key:group.key,key_values:group.key_values,source_records:group.rows.map(x=>({record:x.record,line:x.line,values:x.values})),errors:problems,disposition:'exception',output_rows:[]};
  groups.push(g);
  if(!group.key_values.every(nonempty))problem('TRANSACTION_KEY','Every selected transaction key field must be present.');
  if(m.money.basis==='transaction'&&group.rows.length!==1)problem('DUPLICATE_TRANSACTION','Transaction-basis exports require one row per original transaction.');
  const statusValue=r.get(m.status.field),rule=own(m.status.map,statusValue)?m.status.map[statusValue]:null;
  g.raw_status=statusValue;g.kind=rule?.kind??null;
  if(!rule)problem('STATUS_MAPPING','Unmapped source status: '+statusValue);
  const statusConsistent=same(m.status.field);
  if(!statusConsistent)problem('TRANSACTION_CONFLICT','A transaction has inconsistent status.');
  const totalField=m.money.basis==='allocated-items'?m.money.transaction_total_field:m.money.amount_field;
  const rawTotal=cents(r.get(totalField),m.money.format);
  if(rawTotal===null)problem('AMOUNT','The original transaction total is not an exact decimal USD amount.');
  const grossConsistent=same(totalField);
  if(!grossConsistent)problem('TRANSACTION_CONFLICT','A transaction has inconsistent gross amounts.');
  const normalized=rule&&rawTotal!==null?signedAmount(rawTotal,rule.kind,rule.amount_sign):null;
  if(rule&&rawTotal!==null&&normalized===null)problem('AMOUNT_SIGN','The source amount conflicts with its explicit payment/refund sign policy.');
  const total=statusConsistent&&grossConsistent?normalized:null;
  g.source_amount_cents=grossConsistent&&rawTotal!==null?String(rawTotal):null;g.normalized_amount_cents=total===null?null:String(total);
  g.original_posted_at=r.get(m.date.field);g.receipt_date=receiptDate(g.original_posted_at,m.date.format);
  if(!g.receipt_date)problem('DATE','The posting value does not match its declared calendar/date format.');
  if(!same(m.date.field))problem('TRANSACTION_CONFLICT','A transaction has inconsistent posting values.');
  const outOfRange=g.receipt_date&&((m.date.from&&g.receipt_date<m.date.from)||(m.date.to&&g.receipt_date>m.date.to));
  if(outOfRange&&!problems.length){g.disposition='excluded';g.reason='outside_date_range';if(total!==null)excluded+=total;continue;}
  if(rule&&['void','pending','exclude'].includes(rule.kind)&&!problems.length){
   g.disposition='excluded';g.reason=rule.kind;g.status_meaning=rule.meaning;if(total!==null)excluded+=total;continue;
  }
  const accountId=r.get(m.transactions.account_id),matches=accountMap.get(accountId)||[];
  g.account_id=accountId;g.account_records=matches.map(x=>x.record);
  if(!same(m.transactions.account_id))problem('TRANSACTION_CONFLICT','A transaction points to different accounts.');
  if(matches.length!==1)problem(matches.length?'AMBIGUOUS_ACCOUNT':'ACCOUNT_NOT_FOUND','Require exactly one original account row for '+accountId+'.');
  const name=matches.length===1?m.accounts.name_fields.map(h=>matches[0].get(h)).filter(x=>x!=='').join(m.accounts.name_separator):'';
  if(matches.length===1&&!nonempty(name))problem('ACCOUNT_NAME','The mapped receipt name is empty.');
  const receipt=m.receipt.field?r.get(m.receipt.field):(own(m.receipt.by_transaction,group.key)?m.receipt.by_transaction[group.key]:'');
  if(!nonempty(receipt))problem('RECEIPT_MAPPING','The original transaction lacks its explicit authoritative receipt mapping.');
  if(m.receipt.field&&!same(m.receipt.field))problem('TRANSACTION_CONFLICT','A transaction has inconsistent receipt identities.');
  const paymentRaw=r.get(m.payment.field),payment=own(m.payment.map,paymentRaw)?m.payment.map[paymentRaw]:'';
  if(!nonempty(payment))problem('PAYMENT_MAPPING','Unmapped payment method: '+paymentRaw);
  if(!same(m.payment.field))problem('TRANSACTION_CONFLICT','A transaction has inconsistent payment methods.');
  const candidates=[],itemKeys=new Set();let sum=0n;
  for(const row of group.rows){
   if(m.money.basis==='allocated-items'){
    const keys=m.money.item_key_fields.map(h=>row.get(h)),key=JSON.stringify(keys);
    if(!keys.every(nonempty)||itemKeys.has(key))problem('ITEM_KEY','Every allocated item must have a unique nonempty key within its transaction.');
    itemKeys.add(key);
   }
   const raw=cents(row.get(m.money.amount_field),m.money.format),amount=rule?(m.money.basis==='allocated-items'&&m.money.item_sign==='signed-ledger'?raw:signedAmount(raw,rule.kind,rule.amount_sign)):null;
   if(raw===null)problem('ITEM_AMOUNT','Invalid exact USD amount at source record '+row.record+'.');
   else if(rule&&amount===null)problem('ITEM_SIGN','Source record '+row.record+' conflicts with the selected payment/refund sign.');
   const values=m.gl.fields.map(h=>row.get(h)),gl=m.gl.rules.find(x=>JSON.stringify(x.values)===JSON.stringify(values))?.account;
   if(!gl)problem('GL_MAPPING','Unmapped GL tuple at source record '+row.record+': '+JSON.stringify(values));
   if(amount!==null)sum+=amount;
   candidates.push({date:g.receipt_date,name,gl,receipt,amount,payment,source_record:row.record});
  }
  if(m.money.basis==='allocated-items'&&total!==null&&sum!==total)problem('ALLOCATION_TOTAL','Allocated item cents '+sum+' differ from original transaction cents '+total+'.');
  if(problems.length){if(total!==null)exceptionKnown+=total;continue;}
  g.disposition='included';g.receipt=receipt;g.name=name;g.payment_method=payment;g.output_amount_cents=String(sum);
  for(const item of candidates){
   output.push([item.date,item.name,item.gl,item.receipt,money(item.amount),item.payment]);
   g.output_rows.push({csv_record:output.length+1,source_record:item.source_record,amount_cents:String(item.amount),gl_account:item.gl});
   included+=item.amount;add(byDate,item.date,item.amount);add(byGl,item.gl,item.amount);add(byPayment,item.payment,item.amount);
   if(rule.kind==='payment')payments+=item.amount;else if(rule.kind==='refund')refunds+=item.amount;
  }
 }
 const csv=writeMunicipalCsv([WATERFORD_COLUMNS,...output]);
 const totals=map=>[...map].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>({key,cents:String(value),amount:money(value)}));
 const reconciliation={
  schema:'waterford.municipal-csv-reconciliation.v1',mapping_version:m.version,mapping_sha256:identity(canonical(m)).sha256,
  import_ready:globalErrors.length===0&&groups.every(g=>g.disposition!=='exception'),
  input:{accounts:{...accounts.identity,headers:accounts.headers,records:accounts.rows.length},transactions:{...transactions.identity,headers:transactions.headers,records:transactions.rows.length}},
  date_selection:copy(m.date),money_basis:m.money.basis,currency:'USD',
  summary:{source_transactions:groups.length,included_transactions:groups.filter(g=>g.disposition==='included').length,excluded_transactions:groups.filter(g=>g.disposition==='excluded').length,exception_transactions:groups.filter(g=>g.disposition==='exception').length,output_rows:output.length},
  totals:{included_cents:String(included),payments_cents:String(payments),refunds_cents:String(refunds),excluded_known_cents:String(excluded),exception_known_cents:String(exceptionKnown),exception_unknown_transactions:groups.filter(g=>g.disposition==='exception'&&g.normalized_amount_cents===null).length,by_date:totals(byDate),by_gl:totals(byGl),by_payment:totals(byPayment)},
  errors:globalErrors,account_source_issues:accountIssues,groups,output:{...identity(csv),columns:[...WATERFORD_COLUMNS]},
  mapping:m,
  interpretation:'CSV includes only resolved in-range transactions or reconciled item allocations. Excluded and exception groups retain their original rows. Amounts are gross customer receipt/refund amounts under the explicit source mapping; processor settlement fees and net bank deposits stay separate.'
 };
 return {csv,reconciliation,sources:{accountsCsv,transactionsCsv,mapping:jsonMapping(m)}};
}
const jsonMapping=m=>JSON.stringify(m,null,2)+'\n';
