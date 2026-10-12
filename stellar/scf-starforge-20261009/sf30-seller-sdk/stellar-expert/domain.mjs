// MIT. Explicit source projection, observation comparisons and local review exports.
import {parseExactJSON,decimalUnits,exactPercentage} from './exact-json.mjs';
import {COLUMNS,SOURCE_COLUMNS,SOURCE_CONTRACT} from './schema.mjs';
import {hashBytes,fault} from './provider.mjs';
import {stable,jsonBytes} from './store.mjs';
const string=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
const pick=(out,key,value)=>{out[key]=string(value);};
const ratingKeys=['average','age','trades','payments','trustlines','volume7d','interop','liquidity'];
function sourceRecords(bytes,kind) {
  if(kind==='supply')return [{supply_units:bytes.toString('utf8').trim()}];
  const body=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return Array.isArray(body)?body:body?._embedded?.records??[body];
}
export function normalizeRow(record,query,page,index) {
  if(!record||typeof record!=='object'||Array.isArray(record))throw fault('STELLAR_SOURCE_SHAPE','Expected source records with named fields.',502);
  const out=Object.fromEntries(COLUMNS[query.kind].map(k=>[k,'']));
  for(const key of Object.keys(out))if(Object.hasOwn(record,key))pick(out,key,record[key]);
  if(['holders','rating','supply'].includes(query.kind))pick(out,'asset',record.asset??query.asset);
  if(query.kind==='holders'){pick(out,'balance_stroops',record.balance);pick(out,'balance_units',decimalUnits(string(record.balance)));}
  if(query.kind==='assets'){
    pick(out,'traded_units',decimalUnits(string(record.traded_amount)));pick(out,'payment_units',decimalUnits(string(record.payments_amount)));
    for(const k of ['total','authorized','funded'])pick(out,'trustlines_'+k,record.trustlines?.[k]);
    pick(out,'toml_json',record.tomlInfo??null);
  }
  if(['assets','rating'].includes(query.kind)){
    for(const k of ratingKeys)pick(out,'rating_'+k,record.rating?.[k]);
    if(query.kind==='rating')pick(out,'rating_json',record.rating??null);
  }
  if(query.kind==='directory')pick(out,'tags_json',record.tags??[]);
  Object.assign(out,{sourcePageSha256:page.sha256,sourceRecord:String(index),
    sourceObservedAt:page.finishedAt,sourceUrl:page.url});
  return out;
}
export async function editionRows(store,edition,{offset=0,limit=500}={}) {
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>250000)
    throw fault('STELLAR_ROWS_RANGE','Choose a valid row offset and limit.');
  const rows=[];let current=0;
  for(const page of edition.pages){
    const count=page.records;
    if(current+count<=offset){current+=count;continue;}
    const records=sourceRecords(await store.object(page.sha256),edition.query.kind);
    if(records.length!==count)throw fault('STELLAR_SOURCE_CHANGED','The retained source row count changed.',409);
    for(let i=0;i<records.length;i++){if(current>=offset&&rows.length<limit)rows.push(normalizeRow(records[i],edition.query,page,i));current++;}
    if(rows.length>=limit)break;
  }
  return {columns:[...COLUMNS[edition.query.kind],...SOURCE_COLUMNS],rows,total:edition.recordCount,offset,limit};
}
export async function summarizeEdition(store,edition) {
  const summary={kind:edition.query.kind,coverage:edition.complete?'Provider continuation exhausted':'Retained partial observation',
    firstObservedAt:edition.pages[0]?.startedAt??null,lastObservedAt:edition.pages.at(-1)?.finishedAt??null};
  if(edition.query.kind==='holders'){
    let sum=0n,largest=0n,topTen=0n,index=0,invalid=0;
    for(const page of edition.pages){
      for(const row of sourceRecords(await store.object(page.sha256),'holders')){
        const balance=string(row.balance);if(!/^\d+$/.test(balance)){invalid++;continue;}
        const n=BigInt(balance);sum+=n;if(n>largest)largest=n;if(index++<10)topTen+=n;
      }
    }
    Object.assign(summary,{capturedBalanceStroops:sum.toString(),capturedBalanceUnits:decimalUnits(sum.toString()),
      largestCapturedHolderUnits:decimalUnits(largest.toString()),topTenCapturedUnits:decimalUnits(topTen.toString()),
      largestShareOfCapturedPercent:exactPercentage(largest.toString(),sum.toString()),
      topTenShareOfCapturedPercent:exactPercentage(topTen.toString(),sum.toString()),
      denominator:'Sum of nonnegative balances in these captured rows; not total issued supply.',invalidBalanceRows:invalid});
  }
  return summary;
}
export async function compareEditions(store,left,right){
  if(stable(left.query)!==stable(right.query))throw fault('STELLAR_COMPARISON_QUERY','Compare editions of the same exact provider query.',409);
  const a=await editionRows(store,left,{limit:250000}),b=await editionRows(store,right,{limit:250000});
  const key=row=>row.asset&&left.query.kind==='assets'?row.asset:row.account||row.address||row.domain||row.name||row.asset||row.sequence||'record';
  const index=rows=>{const map=new Map();for(const row of rows){const id=key(row);if(map.has(id))throw fault('STELLAR_COMPARISON_DUPLICATE','This capture contains repeated identities; compare its original pages before merging observations.',409);map.set(id,row);}return map;};
  const before=index(a.rows),after=index(b.rows),added=[],removed=[],changed=[];
  for(const [id,row]of after){
    if(!before.has(id)){added.push({id,row});continue;}
    const old=before.get(id),fields=COLUMNS[left.query.kind].filter(k=>k!=='paging_token'&&old[k]!==row[k]);
    if(fields.length)changed.push({id,changes:fields.map(field=>({field,before:old[field],after:row[field]})),before:old,after:row});
  }
  for(const[id,row]of before)if(!after.has(id))removed.push({id,row});
  return {schema:'stellar-forge.stellar-expert-comparison.v1',leftId:left.id,rightId:right.id,query:left.query,
    coverage:{left:left.complete,right:right.complete,meaning:'Differences between captured observations. A missing row in a partial capture is not evidence that it ceased to exist.'},
    counts:{added:added.length,removed:removed.length,changed:changed.length,unchanged:after.size-added.length-changed.length},
    added,removed,changed};
}
const html=value=>string(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function csvCell(value,{spreadsheet=false}={}) {
  let s=string(value);if(spreadsheet&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csvBytes(columns,rows,{spreadsheet=false}={}) {
  return Buffer.from([columns.map(x=>csvCell(x)).join(','),...rows.map(row=>columns.map(k=>csvCell(row[k],{spreadsheet})).join(','))].join('\r\n')+'\r\n');
}
export async function exportEdition(store,edition,annotations,format) {
  const {columns,rows}=await editionRows(store,edition,{limit:250000});
  if(format==='json')return {bytes:jsonBytes({schema:'stellar-forge.stellar-expert-research-export.v1',
    source:SOURCE_CONTRACT,edition,annotations,columns,rows}),type:'application/json; charset=utf-8',extension:'json'};
  if(format==='csv')return {bytes:csvBytes(columns,rows,{spreadsheet:true}),type:'text/csv; charset=utf-8',extension:'csv',
    note:'Spreadsheet-leading formula characters receive an apostrophe in CSV. Original source bytes and JSON values remain available.'};
  if(format!=='report')throw fault('STELLAR_EXPORT_FORMAT','Choose JSON, CSV or report.');
  const document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+html(edition.label)+' — Stellar asset review</title><style>body{font:14px system-ui;color:#191919;background:#fff;margin:32px;line-height:1.5}h1{font-size:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap}section{margin:24px 0}.scroll{overflow:auto}@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>'+
    '<h1>'+html(edition.label)+'</h1><p>Edition '+html(edition.id)+'</p><p>'+html(SOURCE_CONTRACT.observationMeaning)+'</p>'+
    '<section><h2>Source and coverage</h2><pre>'+html(JSON.stringify({query:edition.query,complete:edition.complete,records:edition.recordCount,
      pages:edition.pageCount,sourceSha256:edition.sourceSha256,summary:edition.summary},null,2))+'</pre><p>'+html(SOURCE_CONTRACT.ratingMeaning)+' '+html(SOURCE_CONTRACT.amountMeaning)+'</p></section>'+
    '<section><h2>Review notes</h2>'+annotations.map(a=>'<h3>'+html(a.subject)+' · '+html(a.status)+'</h3><p>'+html(a.note)+'</p><p>'+html(a.updatedAt)+'</p>').join('')+'</section>'+
    '<section><h2>Captured rows</h2><div class="scroll"><table><thead><tr>'+columns.map(c=>'<th>'+html(c)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(r=>'<tr>'+columns.map(c=>'<td>'+html(r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></section>'+
    '<section><h2>Original response custody</h2><pre>'+html(JSON.stringify(edition.pages,null,2))+'</pre></section></html>';
  return {bytes:Buffer.from(document),type:'text/html; charset=utf-8',extension:'html'};
}
