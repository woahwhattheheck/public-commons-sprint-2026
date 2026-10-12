// MIT. Typed source adapter for the original issued buyer expense period.
// No payment, journal, exchange-rate or merchant-report synthesis occurs here.
import {createHash,randomUUID} from 'node:crypto';

export const BUYER_SOURCE_SCHEMA='stellar-forge.buyer-accountant-source.v1';
export const BUYER_HANDOFF_SCHEMA='stellar-forge.buyer-accountant-handoff.v1';
export const BUYER_RETURN_SCHEMA='stellar-forge.buyer-accountant-return.v1';
export const BUYER_RETURN_PACKET_SCHEMA='stellar-forge.buyer-accountant-return-packet.v1';
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
export const buyerHash=x=>createHash('sha256').update(x).digest('hex');
export function buyerCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){check(Number.isFinite(value),'INVALID_BUYER_SOURCE','A retained source has an invalid number.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(buyerCanonical).join(',')+']';
  check(object(value),'INVALID_BUYER_SOURCE','Retain JSON-compatible source values.');
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+buyerCanonical(value[k])).join(',')+'}';
}
const copy=x=>JSON.parse(buyerCanonical(x));
const seal=x=>({...x,integrity:{sha256:buyerHash(buyerCanonical(x))}});
const text=(x,label,max=2000,empty=false)=>{
  check(typeof x==='string'&&x.length<=max&&(empty||x.trim())&&!/[\u0000-\u001f\u007f]/.test(x),'INVALID_BUYER_SOURCE','Retain '+label+' as exact text.');return x;
};
const ident=(x,label)=>{check(typeof x==='string'&&ID.test(x),'INVALID_BUYER_SOURCE','Retain the original '+label+'.');return x;};
const nativeAmount=(x,label)=>{check(typeof x==='string'&&/^(?:0|[1-9]\d{0,99})$/.test(x),'INVALID_BUYER_SOURCE','Retain '+label+' as an exact nonnegative native-unit string.');return BigInt(x);};
const date=x=>{check(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x,'INVALID_BUYER_SOURCE','Retain the original recognition date.');return x;};
const sourceLineId=(workspace,kind,row)=>buyerHash('stellar-forge.buyer-accountant-line.v1\n'+workspace+'\n'+kind+'\n'+row.coding_id+'\n'+row.line);
const rowId=(handoffId,sourceSha,lineId)=>buyerHash('stellar-forge.buyer-accountant-row.v1\n'+handoffId+'\n'+sourceSha+'\n'+lineId);

export const BUYER_FIELDS=Object.freeze([
  'allocationKind','sourceLineId','item_id','credit_id','source_id','source_name','source_capture','source_kind',
  'request_id','request_digest','recognition_date','network','asset','amount','settled_actual','native_return',
  'native_source_day','native_date_basis','receipt_ref','proof_sha256','packet_id','manifest_sha256',
  'adjustment_id','refund_id','source_reference','order_reference','original_transaction','transaction',
  'transfer_identity','observation_sha256','native_transfer_at','data_context',
  'center_id','center_code','center_name','project','account_code','memo','coding_id','line'
]);
export const BUYER_PROTECTED_COLUMNS=Object.freeze([
  'handoffId','sourceWorkspaceId','sourceCloseId','sourceCloseSequence','sourceContextSha256','sourceReportSha256',
  'rowId','sourceRowSha256',...BUYER_FIELDS,'assetLabel','unitLabel','accountCode','accountName'
]);
export const isBuyerHandoff=x=>x?.schema===BUYER_HANDOFF_SCHEMA;

function amountGroups(rows){
  const groups=new Map();
  for(const row of rows){const key=buyerCanonical([row.network,row.asset]),old=groups.get(key)??{network:row.network,asset:row.asset,amount:0n,lines:0};old.amount+=BigInt(row.amount);old.lines++;groups.set(key,old);}
  return [...groups.values()].map(row=>({...row,amount:row.amount.toString()})).sort((a,b)=>buyerCanonical([a.network,a.asset]).localeCompare(buyerCanonical([b.network,b.asset])));
}
function compareTotals(rows,totals,label){
  check(Array.isArray(totals),'INVALID_BUYER_SOURCE','Retain the original '+label+'.');
  const normalize=x=>x.map(row=>({network:row.network,asset:row.asset,amount:row.amount,lines:row.lines})).sort((a,b)=>buyerCanonical([a.network,a.asset]).localeCompare(buyerCanonical([b.network,b.asset])));
  check(buyerCanonical(amountGroups(rows))===buyerCanonical(normalize(totals)),'BUYER_TOTALS_CHANGED','The issued '+label+' do not match the retained allocation lines.',409);
}

/** Validate a closed, reviewed original period while retaining every source field. */
export function inspectBuyerSource(input){
  const raw=Buffer.from(input);
  check(raw.length>0&&raw.length<=64*1024*1024,'BUYER_SOURCE_SIZE','Choose an original buyer source JSON file up to 64 MiB.');
  let source;try{source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{check(false,'INVALID_BUYER_SOURCE','Choose original UTF-8 buyer source JSON.');}
  check(object(source)&&source.schema===BUYER_SOURCE_SCHEMA&&object(source.issued),'BUYER_SOURCE_REQUIRED','Export an issued accountant source from the original buyer expense workspace.');
  ident(source.workspaceId,'buyer workspace identity');
  const close=source.issued;
  check(close.schema==='stellar-forge.buyer-expense-period.v1'&&close.status==='CLOSED'&&close.ready===true&&close.unresolved===0&&object(close.period)&&close.period.state==='CLOSED'&&close.period.latest_close===close.id&&object(close.review)&&close.review.decision==='READY','BUYER_ISSUED_SOURCE_REQUIRED','Use a retained closed edition with its original completed review.');
  ident(close.id,'issued close identity');ident(close.period.id,'buyer period identity');
  check(Number.isSafeInteger(close.sequence)&&close.sequence>0&&HEX.test(close.context_sha256)&&typeof close.created_at==='string'&&Number.isFinite(Date.parse(close.created_at)),'INVALID_BUYER_SOURCE','Retain the issued sequence, time and source context.');
  const start=date(close.period.from_day),end=date(close.period.through_day);
  check(start<=end&&['operational','development'].includes(close.data_context??'operational'),'INVALID_BUYER_SOURCE','Retain the original period scope and data context.');
  check(Array.isArray(close.allocations)&&Array.isArray(close.credit_allocations??[])&&close.allocations.length+(close.credit_allocations??[]).length<=22000,'BUYER_ROW_LIMIT','Retain up to 22,000 issued expense and credit allocation lines.');
  const seen=new Set(),rows=[],economic=new Map();
  for(const [kind,lines]of [['EXPENSE',close.allocations],['CREDIT',close.credit_allocations??[]]]){
    for(const original of lines){
      check(object(original),'INVALID_BUYER_SOURCE','Retain the complete original allocation object.');
      for(const key of ['item_id','coding_id','source_id','source_capture','center_id'])ident(original[key],key);
      if(kind==='CREDIT')ident(original.credit_id,'credit identity');
      check(Number.isSafeInteger(original.line)&&original.line>0,'INVALID_BUYER_SOURCE','Retain the original positive allocation line number.');
      text(original.network,'network',200);text(original.asset,'asset',1000);text(original.center_code,'cost center code',160);text(original.project,'project',2000,true);text(original.account_code,'account code',160,true);
      const amount=nativeAmount(original.amount,'allocation amount'),maximum=nativeAmount(kind==='EXPENSE'?original.settled_actual:original.native_return,'original economic amount');
      check(amount<=maximum,'BUYER_ALLOCATION_CHANGED','An allocation exceeds its original economic amount.',409);
      const economicKey=buyerCanonical([kind,kind==='CREDIT'?original.credit_id:original.item_id]);
      const previous=economic.get(economicKey);
      if(previous)check(previous.network===original.network&&previous.asset===original.asset&&previous.maximum===maximum,
        'BUYER_ECONOMIC_SOURCE_CHANGED','Allocation lines disagree on their original economic amount or denomination.',409);
      const allocated=(previous?.allocated??0n)+amount;
      check(allocated<=maximum,'BUYER_ALLOCATION_CHANGED','The combined allocations exceed their original expense or returned-credit amount.',409);
      economic.set(economicKey,{network:original.network,asset:original.asset,maximum,allocated});
      check(date(original.recognition_date)>=start&&original.recognition_date<=end,'BUYER_DATE_CHANGED','An allocation falls outside the frozen buyer period.',409);
      const identity=sourceLineId(source.workspaceId,kind,original);
      check(!seen.has(identity),'BUYER_LINE_REPEATED','The issued source repeats an allocation identity.',409);seen.add(identity);
      rows.push({kind,sourceLineId:identity,original:copy(original)});
    }
  }
  compareTotals(close.allocations,close.totals,'expense totals');
  if(close.credit_totals)compareTotals(close.credit_allocations??[],close.credit_totals,'credit totals');
  if(close.net_totals)compareTotals([...close.allocations,...(close.credit_allocations??[]).map(row=>({...row,amount:(-BigInt(row.amount)).toString()}))],close.net_totals,'net totals');
  const sha256=buyerHash(raw),closeSha256=buyerHash(buyerCanonical(close));
  return {document:source,raw,sha256,closeSha256,rows,
    source:{kind:'buyer-expense-period',runId:null,reportSha256:sha256,reportBytes:raw.length,reportSchema:BUYER_SOURCE_SCHEMA,reportCreatedAt:close.created_at,
      periodClose:{id:close.id,revision:close.sequence,sha256:closeSha256,schema:close.schema,period:copy(close.period)},
      buyer:{workspaceId:source.workspaceId,periodId:close.period.id,closeId:close.id,sequence:close.sequence,contextSha256:close.context_sha256,
        dataContext:close.data_context??'operational',review:copy(close.review),totals:copy(close.totals),creditTotals:copy(close.credit_totals??[]),netTotals:copy(close.net_totals??close.totals),
        outstandingReservations:copy(close.outstanding_reservations??[]),sourceCaptures:copy(close.source_captures??[])}}
  };
}

export function createBuyerHandoff({buyerSourceBytes,name,actor,id=randomUUID(),createdAt=new Date().toISOString(),labels=[]}={}){
  const inspected=inspectBuyerSource(buyerSourceBytes);ident(id,'handoff identity');text(name,'handoff name',160);text(actor,'operator',1000);
  check(typeof createdAt==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(createdAt)&&Number.isFinite(Date.parse(createdAt)),'INVALID_BUYER_SOURCE','Use a creation timestamp with an explicit time zone.');
  check(Array.isArray(labels)&&labels.length===0,'BUYER_LABELS_RETAINED','Buyer account and allocation labels come from the issued source.');
  const rows=inspected.rows.map(row=>({...row,rowId:rowId(id,inspected.sha256,row.sourceLineId),sourceRowSha256:buyerHash(buyerCanonical(row.original)),
    label:{assetLabel:row.original.asset,unitLabel:'native atomic units',accountCode:row.original.account_code,accountName:''}}));
  const summary={totalRows:rows.length,expenseRows:rows.filter(row=>row.kind==='EXPENSE').length,creditRows:rows.filter(row=>row.kind==='CREDIT').length,
    testnetRows:rows.filter(row=>row.original.network==='stellar:testnet').length,publicNetworkRows:rows.filter(row=>row.original.network==='stellar:pubnet').length,
    dataContext:inspected.source.buyer.dataContext,outstandingReservations:inspected.source.buyer.outstandingReservations.length};
  return seal({schema:BUYER_HANDOFF_SCHEMA,id,name,actor,createdAt,source:inspected.source,
    sourceHashes:{buyerSourceSha256:inspected.sha256,issuedCloseSha256:inspected.closeSha256},sourceAccountingStatus:'ISSUED_BUYER_PERIOD',
    sourceOptions:[],labels:[],rows,summary});
}
export function validateBuyerHandoff(handoff){
  check(isBuyerHandoff(handoff)&&object(handoff.integrity)&&HEX.test(handoff.integrity.sha256),'INVALID_BUYER_HANDOFF','Choose a retained buyer accountant handoff.');
  const {integrity,...body}=handoff;
  check(buyerHash(buyerCanonical(body))===integrity.sha256,'BUYER_HANDOFF_CHANGED','The retained buyer handoff changed.',409);
  ident(handoff.id,'handoff identity');
  check(handoff.source?.kind==='buyer-expense-period'&&object(handoff.source.buyer)&&HEX.test(handoff.source.reportSha256)&&Array.isArray(handoff.rows)&&handoff.rows.length<=22000,'INVALID_BUYER_HANDOFF','Retain the complete typed buyer source identity.');
  ident(handoff.source.buyer.workspaceId,'buyer workspace identity');
  const seen=new Set();
  for(const row of handoff.rows){
    check(object(row)&&['EXPENSE','CREDIT'].includes(row.kind)&&object(row.original)&&object(row.label)&&HEX.test(row.sourceLineId)&&row.sourceLineId===sourceLineId(handoff.source.buyer.workspaceId,row.kind,row.original)&&row.rowId===rowId(handoff.id,handoff.source.reportSha256,row.sourceLineId)&&row.sourceRowSha256===buyerHash(buyerCanonical(row.original)),'BUYER_HANDOFF_ROW_CHANGED','A frozen buyer allocation or identity changed.',409);
    check(!seen.has(row.sourceLineId),'BUYER_LINE_REPEATED','The handoff repeats an original buyer allocation.',409);seen.add(row.sourceLineId);
  }
  return handoff;
}
export function buyerProtectedValues(handoff,row){
  return {...row.original,handoffId:handoff.id,sourceWorkspaceId:handoff.source.buyer.workspaceId,sourceCloseId:handoff.source.buyer.closeId,
    sourceCloseSequence:handoff.source.buyer.sequence,sourceContextSha256:handoff.source.buyer.contextSha256,
    sourceReportSha256:handoff.source.reportSha256,rowId:row.rowId,sourceRowSha256:row.sourceRowSha256,
    allocationKind:row.kind,sourceLineId:row.sourceLineId,assetLabel:row.label.assetLabel,unitLabel:row.label.unitLabel,
    accountCode:row.label.accountCode,accountName:row.label.accountName};
}

const html=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderBuyerAccountantHtml(view,revision){
  const rows=view.rows.map(row=>'<tr><td>'+html(row.kind)+'<br><small>'+html(row.sourceLineId)+'</small></td><td>'+html(row.original.source_name)+'<br>'+html(row.original.item_id)+'<br>'+html(row.original.credit_id??'')+'</td><td>'+html(row.original.amount)+'<br>'+html(row.original.network)+'<br><small>'+html(row.original.asset)+'</small></td><td>'+html(row.original.recognition_date)+'<br>'+html(row.original.center_code)+' · '+html(row.original.project)+'<br>'+html(row.original.account_code)+'</td><td>'+html(row.externalStatus)+'<br>'+html(row.externalBookRef)+'<br>'+html(row.externalAccountCode)+'</td><td>'+html(row.externalNote)+'</td></tr>').join('');
  const issues=(revision?.issues??[]).map(item=>'<tr><td>'+html(item.rowNumber)+'</td><td>'+html(item.code)+'</td><td>'+html(item.message)+'</td></tr>').join('');
  const b=view.source.buyer;
  return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html(view.name)+'</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;color:#222;background:#fff;font:14px/1.5 system-ui}main{max-width:1500px;margin:auto}h1{font-size:26px}p,dd,small,code{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px}dd{margin:0}.table{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;min-width:950px}td,th{border:1px solid #bbb;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}small{font-size:11px}td:last-child{white-space:pre-wrap}@media(max-width:600px){body{padding:16px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:8px}}@media print{.table{overflow:visible}table{min-width:0}}</style><main><h1>'+html(view.name)+'</h1><p>Accountant review of an issued buyer expense period. Expense and returned-credit allocations retain their original native units, source context and recognition dates. The four external bookkeeping fields record returned accountant information separately.</p><dl><dt>Buyer workspace</dt><dd>'+html(b.workspaceId)+'</dd><dt>Issued period</dt><dd>'+html(b.closeId)+' · edition '+html(b.sequence)+'</dd><dt>Source context</dt><dd>'+html(b.dataContext)+'</dd><dt>Original source SHA256</dt><dd>'+html(view.source.reportSha256)+'</dd><dt>Accountant handoff</dt><dd>'+html(view.id)+'</dd><dt>Return</dt><dd>'+html(revision?.id??'No returned revision')+'</dd></dl><h2>Issued allocations</h2><div class="table"><table><thead><tr><th>Kind / source line</th><th>Original buyer source</th><th>Allocated native units</th><th>Recognition / coding</th><th>Returned status / book / account</th><th>Returned note</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(issues?'<h2>Retained return findings</h2><div class="table"><table><thead><tr><th>CSV row</th><th>Code</th><th>Detail</th></tr></thead><tbody>'+issues+'</tbody></table></div>':'')+'<p>Native amounts are not converted into fiat. Any journal valuation requires an explicit base-currency amount, date, chart accounts and valuation source. Unsent reservations and unresolved source outcomes remain in the original issued source.</p></main></html>');
}
