// MIT. Official USAspending award transaction projection and comparison.
// Contract: https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/transactions.md
import { createHash } from 'node:crypto';

export const TRANSACTION_VERSION = 'usaspending-award-transactions-v1';
export const TRANSACTION_PATH = '/api/v2/transactions/';
export const MONEY_FIELDS = Object.freeze(['federal_action_obligation','face_value_loan_guarantee','original_loan_subsidy_cost']);
export const TRANSACTION_COLUMNS = Object.freeze(['award_key','transaction_id','action_date','modification_number','type','type_description','action_type','action_type_description','description',...MONEY_FIELDS,'cfda_number','source_id','source_page','source_index','row_sha256']);
const SORT_FIELDS = new Set(['action_date','modification_number',...MONEY_FIELDS,'action_type_description','description']);
const TEXT_FIELDS = ['type','type_description','action_type','action_type_description','description','modification_number','cfda_number'];
export function demand(ok, code, message=code, status=400) { if(!ok) throw Object.assign(new Error(message),{code,status}); }
export function stable(value) {
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function object(value) { return value!==null && typeof value==='object' && !Array.isArray(value); }
function integer(value,name,min,max) { demand(Number.isSafeInteger(value)&&value>=min&&value<=max,'TRANSACTION_'+name.toUpperCase()+'_INVALID');return value; }
export function originalAwardKey(value) {
  demand(typeof value==='string' && /^(CONT_AWD_|CONT_IDV_|ASST_NON_|ASST_AGG_)/.test(value) && value.length<=1024 && !/[\u0000-\u0020\/\\?#]/.test(value),'TRANSACTION_AWARD_KEY_INVALID','Select the original generated award identity.');
  return value;
}
export function transactionRequest(awardKey,{page=1,limit=250,sort='action_date',order='asc'}={}) {
  demand(SORT_FIELDS.has(sort),'TRANSACTION_SORT_INVALID');
  demand(order==='asc'||order==='desc','TRANSACTION_ORDER_INVALID');
  return {award_id:originalAwardKey(awardKey),page:integer(page,'page',1,10000000),limit:integer(limit,'limit',1,5000),sort,order};
}
export function money(value) {
  if(value===null||value===undefined) return null;
  demand(typeof value==='string','TRANSACTION_DECIMAL_SOURCE_REQUIRED','Monetary numbers must be read from their original JSON tokens.');
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  demand(match,'TRANSACTION_DECIMAL_INVALID');
  const exponent=Number(match[4]??0);
  demand(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=1000&&value.length<=4096,'TRANSACTION_DECIMAL_RANGE');
  let digits=(match[2]+(match[3]??'')).replace(/^0+(?=\d)/,'');
  let places=(match[3]??'').length-exponent;
  if(places<0) { digits+='0'.repeat(-places);places=0; }
  if(places>=digits.length) digits='0'.repeat(places-digits.length+1)+digits;
  let result=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;
  if(result.includes('.')) result=result.replace(/0+$/,'').replace(/\.$/,'');
  result=result.replace(/^0+(?=\d)/,'');
  if(!result||/^0(?:\.0*)?$/.test(result))return '0';
  return (match[1]||'')+result;
}
function units(value,scale) {
  const negative=value.startsWith('-'),part=(negative?value.slice(1):value).split('.');
  return BigInt((negative?'-':'')+part[0]+(part[1]??'').padEnd(scale,'0'));
}
export function sumMoney(values) {
  const normalized=values.map(money);
  if(normalized.some(x=>x===null))return null;
  const scale=normalized.reduce((maximum,x)=>Math.max(maximum,(x.split('.')[1]??'').length),0);
  const sum=normalized.reduce((n,x)=>n+units(x,scale),0n);
  const negative=sum<0n,raw=(negative?-sum:sum).toString().padStart(scale+1,'0');
  return money((negative?'-':'')+(scale?raw.slice(0,-scale)+'.'+raw.slice(-scale):raw));
}
export function subtractMoney(after,before) {
  if(after===null||before===null)return null;
  const b=money(before);
  return sumMoney([after,b==='0'?'0':b.startsWith('-')?b.slice(1):'-'+b]);
}
export function parseTransactionJSON(bytes) {
  const input=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  demand(input.length>0&&input.length<=32*1024*1024,'TRANSACTION_RESPONSE_SIZE');
  let value;
  try {
    value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input),(key,item,context)=>{
      if(MONEY_FIELDS.includes(key)&&typeof item==='number') {
        demand(typeof context?.source==='string','TRANSACTION_JSON_SOURCE_CONTEXT_REQUIRED','Use Node 22.13 or newer to preserve monetary tokens.');
        return context.source;
      }
      return item;
    });
  } catch(error) {
    if(error.code)throw error;
    throw Object.assign(new Error('The original transaction response is not valid UTF-8 JSON.'),{code:'TRANSACTION_RESPONSE_JSON_INVALID',status:400});
  }
  demand(object(value),'TRANSACTION_RESPONSE_OBJECT_REQUIRED');
  return value;
}
export function normalizeTransaction(row,{awardKey,sourceId,sourcePage,sourceIndex}) {
  demand(object(row),'TRANSACTION_ROW_INVALID');
  demand(typeof row.id==='string'&&row.id.length>0&&row.id.length<=4096,'TRANSACTION_ID_INVALID');
  demand(typeof row.action_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.action_date),'TRANSACTION_ACTION_DATE_INVALID');
  const actionDate=new Date(row.action_date+'T00:00:00Z');
  demand(Number.isFinite(actionDate.getTime())&&actionDate.toISOString().slice(0,10)===row.action_date,'TRANSACTION_ACTION_DATE_INVALID');
  const output={award_key:originalAwardKey(awardKey),transaction_id:row.id,action_date:row.action_date};
  for(const key of TEXT_FIELDS) { const value=row[key]??null;demand(value===null||typeof value==='string','TRANSACTION_FIELD_INVALID',key+' must retain a string or null.');output[key]=value; }
  for(const key of MONEY_FIELDS)output[key]=money(row[key]);
  output.source_id=sourceId;output.source_page=sourcePage;output.source_index=sourceIndex;
  output.row_sha256=digest(stable(row));
  return output;
}
export function parseTransactionPage(bytes,request,{sourceId}={}) {
  demand(object(request),'TRANSACTION_REQUEST_REQUIRED');
  const expected=transactionRequest(request.award_id,request);
  demand(stable(expected)===stable(request),'TRANSACTION_REQUEST_FIELDS_INVALID','Retain the exact supported official request fields.');
  const raw=parseTransactionJSON(bytes),meta=raw.page_metadata;
  demand(Array.isArray(raw.results)&&raw.results.length<=request.limit&&object(meta),'TRANSACTION_PAGE_INVALID');
  demand(meta.page===request.page&&typeof meta.hasNext==='boolean'&&typeof meta.hasPrevious==='boolean','TRANSACTION_PAGE_METADATA_INVALID');
  if(meta.hasNext) {
    integer(meta.next,'next_page',request.page+1,request.page+1);
    demand(raw.results.length>0,'TRANSACTION_EMPTY_CONTINUATION','The provider returned an empty continuing page; resume the original request after review.');
  } else demand(meta.next===null,'TRANSACTION_PAGE_NEXT_INVALID');
  demand(meta.hasPrevious===(request.page>1)&&meta.previous===(request.page>1?request.page-1:null),'TRANSACTION_PAGE_PREVIOUS_INVALID');
  const rows=raw.results.map((row,index)=>normalizeTransaction(row,{awardKey:request.award_id,sourceId:sourceId??digest(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes)),sourcePage:request.page,sourceIndex:index}));
  return {raw,rows,metadata:meta,nextRequest:meta.hasNext?{...request,page:meta.next}:null};
}
export function analyzeTransactions(rows,{award=null,coverage=null}={}) {
  demand(Array.isArray(rows),'TRANSACTION_ROWS_REQUIRED');
  const byId=new Map(),duplicateOccurrences=[],conflicts=[];
  for(const row of rows) {
    const previous=byId.get(row.transaction_id);
    if(!previous)byId.set(row.transaction_id,row);
    else {
      const record={transaction_id:row.transaction_id,first:{source_id:previous.source_id,page:previous.source_page,index:previous.source_index,row_sha256:previous.row_sha256},later:{source_id:row.source_id,page:row.source_page,index:row.source_index,row_sha256:row.row_sha256}};
      (previous.row_sha256===row.row_sha256?duplicateOccurrences:conflicts).push(record);
    }
  }
  const unique=[...byId.values()].sort((a,b)=>a.action_date.localeCompare(b.action_date)||a.transaction_id.localeCompare(b.transaction_id));
  const conflicted=new Set(conflicts.map(x=>x.transaction_id));
  const known=unique.filter(r=>!conflicted.has(r.transaction_id));
  const amounts=known.map(r=>r.federal_action_obligation),present=amounts.filter(x=>x!==null);
  const positive=present.filter(x=>!x.startsWith('-')&&x!=='0'),negative=present.filter(x=>x.startsWith('-'));
  const years={};
  const fiscalYear=row=>String(Number(row.action_date.slice(0,4))+(Number(row.action_date.slice(5,7))>=10?1:0));
  const yearBucket=year=>years[year]??={
    fiscal_year:year,transactions:0,amounts:[],unknown_amounts:0,
    conflicted_transactions:0,ambiguous_fiscal_year_transactions:0
  };
  for(const row of known) {
    const bucket=yearBucket(fiscalYear(row));
    bucket.transactions++;bucket.amounts.push(row.federal_action_obligation);
    if(row.federal_action_obligation===null)bucket.unknown_amounts++;
  }
  // Every source occurrence contributes its possible year; a conflict never vanishes from a subtotal.
  const conflictYears=new Map();
  for(const row of rows)if(conflicted.has(row.transaction_id)) {
    const candidates=conflictYears.get(row.transaction_id)??new Set();
    candidates.add(fiscalYear(row));conflictYears.set(row.transaction_id,candidates);
  }
  for(const candidates of conflictYears.values())for(const year of candidates) {
    const bucket=yearBucket(year);
    bucket.transactions++;bucket.conflicted_transactions++;bucket.amounts.push(null);
    if(candidates.size>1)bucket.ambiguous_fiscal_year_transactions++;
  }
  const byFiscalYear=Object.values(years).map(({amounts,transactions,...rest})=>({
    ...rest,
    transactions:rest.ambiguous_fiscal_year_transactions?null:transactions,
    possible_transactions:transactions,
    net_obligation_usd:sumMoney(amounts),
    known_obligation_usd:sumMoney(amounts.filter(x=>x!==null))
  })).sort((a,b)=>Number(a.fiscal_year)-Number(b.fiscal_year));
  let running='0',runningKnown='0';
  const timeline=unique.map(row=>{
    const reliable=!conflicted.has(row.transaction_id),amount=reliable?row.federal_action_obligation:null;
    running=running===null||amount===null?null:sumMoney([running,amount]);
    if(amount!==null)runningKnown=sumMoney([runningKnown,amount]);
    return {...row,source_conflict:!reliable,running_obligation_usd:running,running_known_obligation_usd:runningKnown};
  });
  const net=conflicts.length?null:sumMoney(amounts),total=money(award?.total_obligation_usd??award?.obligation_usd??null);
  return {schema:TRANSACTION_VERSION,coverage,occurrences:rows.length,unique_transactions:unique.length,duplicate_occurrences:duplicateOccurrences,conflicts,first_action_date:unique[0]?.action_date??null,last_action_date:unique.at(-1)?.action_date??null,positive_obligation_usd:sumMoney(positive),deobligation_usd:sumMoney(negative),known_net_obligation_usd:sumMoney(present),net_obligation_usd:net,unknown_amounts:amounts.filter(x=>x===null).length,zero_obligation_transactions:present.filter(x=>x==='0').length,award_obligation_usd:total,award_obligation_difference_usd:total!==null?subtractMoney(net,total):null,by_fiscal_year:byFiscalYear,timeline};
}
export function compareTransactions(before,after) {
  demand(object(before)&&object(after),'TRANSACTION_COMPARE_CAPTURE_REQUIRED');
  const awardKey=originalAwardKey(before.award_key);
  demand(awardKey===after.award_key,'TRANSACTION_COMPARE_AWARD_MISMATCH');
  demand(Array.isArray(before.rows)&&Array.isArray(after.rows),'TRANSACTION_ROWS_REQUIRED');
  demand(before.rows.every(row=>row?.award_key===awardKey)&&after.rows.every(row=>row?.award_key===awardKey),'TRANSACTION_COMPARE_ROW_AWARD_MISMATCH');
  const a=analyzeTransactions(before.rows,{coverage:before.coverage}),b=analyzeTransactions(after.rows,{coverage:after.coverage});
  const left=new Map(a.timeline.map(r=>[r.transaction_id,r])),right=new Map(b.timeline.map(r=>[r.transaction_id,r]));
  const changes=[],added=[],absent=[],unresolved=[];
  const fields=['action_date',...TEXT_FIELDS,...MONEY_FIELDS];
  const unresolvedRow=(key,old,row)=>({
    transaction_id:key,reason:'source_conflict',
    before_present:Boolean(old),after_present:Boolean(row),
    before_source_conflict:Boolean(old?.source_conflict),
    after_source_conflict:Boolean(row?.source_conflict),
    obligation_delta_usd:null
  });
  for(const [key,row] of right) {
    const old=left.get(key);
    if(old?.source_conflict||row.source_conflict) {
      unresolved.push(unresolvedRow(key,old,row));continue;
    }
    if(!old)added.push(row);
    else {
      const changed=fields.filter(f=>row[f]!==old[f]).map(field=>({field,before:old[field],after:row[field]}));
      if(changed.length)changes.push({transaction_id:key,fields:changed,obligation_delta_usd:subtractMoney(row.federal_action_obligation,old.federal_action_obligation)});
    }
  }
  for(const [key,row] of left)if(!right.has(key)) {
    if(row.source_conflict)unresolved.push(unresolvedRow(key,row,null));
    else absent.push(row);
  }
  return {schema:TRANSACTION_VERSION,award_key:awardKey,before_id:before.id,after_id:after.id,before_coverage:before.coverage,after_coverage:after.coverage,added,changed:changes,absent_in_later_capture:absent,unresolved,net_obligation_delta_usd:subtractMoney(b.net_obligation_usd,a.net_obligation_usd),source_conflicts:{before:a.conflicts,after:b.conflicts}};
}
export function transactionCsv(rows,{spreadsheet=false}={}) {
  const cell=value=>{
    let s=value===null||value===undefined?'':String(value);
    if(spreadsheet&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  return [TRANSACTION_COLUMNS.join(','),...rows.map(row=>TRANSACTION_COLUMNS.map(k=>cell(row[k])).join(','))].join('\r\n')+'\r\n';
}
