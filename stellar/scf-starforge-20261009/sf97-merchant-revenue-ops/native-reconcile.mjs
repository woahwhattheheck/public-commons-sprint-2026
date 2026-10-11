// MIT. SF97 merchant revenue view joined to ORIGINAL SF98 native-success outbox.
// Read-only source reconciliation, not payment verification or a transaction ledger.
import { createHash } from 'node:crypto';
import { lstat, readFile, mkdir, open } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const HASH=/^[a-f0-9]{64}$/;
const NATIVE='stellar-forge.sf98.delivery-event.v1';
const TRAFFIC='stellar-forge.merchant-revenue-ops.v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=x=>{throw new Error(x);};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const number=x=>Number.isSafeInteger(x)&&x>=0;
const flags=['DELIVERED','RETRY','EXHAUSTED','REQUEUE'];
async function strictFile(path,max=64*1024*1024){
  if(!isAbsolute(path)||resolve(path)!==path)fail('ABSOLUTE_NORMALIZED_SOURCE_REQUIRED');
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>max||(s.mode&0o077)!==0)
    fail('PRIVATE_SOURCE_FILE_REQUIRED_0600');
  const bytes=await readFile(path);
  if(bytes.length>max)fail('SOURCE_SIZE_EXCEEDED');
  return bytes;
}
async function journal(path){
  let bytes;
  try{bytes=await strictFile(path);}
  catch(e){if(e.code==='ENOENT')return {rows:[],hash:null,bytes:0};throw e;}
  const source=bytes.toString('utf8');
  if(source&&!source.endsWith('\n'))fail('TRUNCATED_ORIGINAL_SF98_JOURNAL');
  const rows=source.split('\n').filter(Boolean).map((line,index)=>{
    let r;try{r=JSON.parse(line);}catch{fail('INVALID_ORIGINAL_SF98_JSON_LINE_'+(index+1));}
    if(!object(r))fail('INVALID_ORIGINAL_SF98_JOURNAL_ROW_'+(index+1));
    return r;
  });
  return {rows,hash:sha(bytes),bytes:bytes.length};
}
function nativeEvent(e){
  if(e.schema!==NATIVE||!HASH.test(e.id)||
    typeof e.routeId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(e.routeId)||
    !['GET','HEAD','POST'].includes(e.method)||typeof e.network!=='string'||
    typeof e.amountAtomic!=='string'||!/^[0-9]+$/.test(e.amountAtomic)||
    typeof e.assetDigest!=='string'||!HASH.test(e.assetDigest)||
    !HASH.test(e.receiptFingerprint)||e.authority!=='ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS'||
    !Number.isFinite(time(e.at)))fail('NONCANONICAL_ORIGINAL_SF98_NATIVE_EVENT');
}
function delivery(d,ids){
  if(!HASH.test(d.id)||!ids.has(d.id)||!flags.includes(d.state)||
    !number(d.attempt)||!Number.isFinite(time(d.at)))fail('INVALID_OR_ORPHAN_SF98_DELIVERY');
}
function traffic(report){
  if(!object(report)||report.schema!==TRAFFIC||
    !['CHALLENGE_ONLY','NATIVE_X402','UNKNOWN'].includes(report.originalSellerMode)||
    !Array.isArray(report.routes)||report.routes.length===0||
    !Number.isFinite(time(report.observedFrom))||
    !Number.isFinite(time(report.observedUntil))||
    time(report.observedFrom)>time(report.observedUntil))fail('INVALID_ORIGINAL_SF97_REPORT');
  const ids=new Set();
  for(const r of report.routes){
    if(!object(r)||typeof r.routeId!=='string'||ids.has(r.routeId)||
      typeof r.method!=='string'||!object(r.payment)||
      !['stellar:testnet','stellar:pubnet'].includes(r.payment.network)&&
        !/^stellar:[a-z0-9_-]+$/.test(String(r.payment.network))||
      typeof r.payment.atomicAmount!=='string'||!/^[0-9]+$/.test(r.payment.atomicAmount)||
      typeof r.payment.asset!=='string'||
      !/^[0-9]+$/.test(String(r.actual2xx))||
      !/^[0-9]+$/.test(String(r.actual402)))fail('INVALID_ORIGINAL_SF97_ROUTE');
    ids.add(r.routeId);
  }
}
export function reconcile(report,events,deliveries){
  traffic(report);
  const routes=new Map(report.routes.map(r=>[r.routeId,r]));
  const seen=new Map(),issue=[];
  for(const e of events){
    nativeEvent(e);
    if(seen.has(e.id)){
      if(JSON.stringify(seen.get(e.id))!==JSON.stringify(e))fail('CONFLICTING_SF98_NATIVE_EVENT_ID');
      continue;
    }
    seen.set(e.id,e);
  }
  const outcomes=new Map();
  for(const d of deliveries){delivery(d,seen);outcomes.set(d.id,d);}
  const from=time(report.observedFrom),until=time(report.observedUntil);
  const observed=[...seen.values()].filter(e=>time(e.at)>=from&&time(e.at)<=until);
  const outside=seen.size-observed.length;
  const byRoute=new Map();
  for(const r of report.routes)byRoute.set(r.routeId,{
    routeId:r.routeId,method:r.method,http2xx:Number(r.actual2xx),
    http402:Number(r.actual402),nativeSuccessEvents:0,
    acceptedByMerchantInbox:0,pendingDelivery:0,exhaustedDelivery:0,
    quotedUsd:r.quoteUsd,flags:[]
  });
  let unassigned=0;
  for(const e of observed){
    const r=routes.get(e.routeId);
    if(!r){unassigned++;issue.push({routeId:e.routeId,flag:'Original SF98 event route is absent from this SF97 seller report'});continue;}
    const same=r.method===e.method&&r.payment.network===e.network&&
      r.payment.atomicAmount===e.amountAtomic&&sha(String(r.payment.asset))===e.assetDigest;
    if(!same){
      unassigned++;issue.push({routeId:e.routeId,flag:'Native SF98 original payment identity differs: method/network/amount/asset digest'});
      continue;
    }
    const row=byRoute.get(e.routeId);
    row.nativeSuccessEvents++;
    const state=outcomes.get(e.id)?.state??'PENDING';
    if(state==='DELIVERED')row.acceptedByMerchantInbox++;
    else if(state==='EXHAUSTED')row.exhaustedDelivery++;
    else row.pendingDelivery++;
  }
  const aligned=[...byRoute.values()];
  for(const row of aligned){
    if(row.nativeSuccessEvents>0&&report.originalSellerMode==='CHALLENGE_ONLY')
      row.flags.push('Native success inside a challenge-only observation window: verify same original seller/session/source');
    if(row.nativeSuccessEvents>row.http2xx)
      row.flags.push('Native-success journal count exceeds observed HTTP 2xx in this window: check observer completeness/window');
    if(row.exhaustedDelivery)row.flags.push('Merchant callback delivery exhausted: repair merchant receiver and requeue explicitly');
    if(row.pendingDelivery)row.flags.push('Native-success callbacks awaiting merchant inbox delivery');
    issue.push(...row.flags.map(flag=>({routeId:row.routeId,flag})));
  }
  if(outside)issue.push({routeId:'*',flag:String(outside)+' native SF98 event(s) predate/postdate this original SF30 observation window; excluded, not discarded'});
  if(unassigned)issue.push({routeId:'*',flag:String(unassigned)+' native SF98 event(s) in window not aligned to original seller payment identity; require operator reconciliation'});
  const totals={
    originalOutboxEvents:seen.size,withinObservedWindow:observed.length,
    alignedNativeSuccessEvents:aligned.reduce((a,r)=>a+r.nativeSuccessEvents,0),
    deliveredToMerchantInbox:aligned.reduce((a,r)=>a+r.acceptedByMerchantInbox,0),
    pendingDelivery:aligned.reduce((a,r)=>a+r.pendingDelivery,0),
    exhaustedDelivery:aligned.reduce((a,r)=>a+r.exhaustedDelivery,0),
    unmatchedEventIdentity:unassigned,outsideObservationWindow:outside
  };
  return {schema:'stellar-forge.sf97-native-merchant-reconciliation.v1',
    generatedAt:new Date().toISOString(),merchantName:report.merchantName,
    sessionId:report.sessionId,sellerMode:report.originalSellerMode,
    observedFrom:report.observedFrom,observedUntil:report.observedUntil,
    totals,routes:aligned,issues:issue,
    boundaries:{
      originalSf98NativeProcessSettlementOnly:true,
      nativeEventIsIndependentChainProof:false,customerFulfillmentKnown:false,
      callbackDeliveredDoesNotProveMerchantFulfilled:true,
      revenueBooked:false,sessionsMustBeOperatorCorrelated:true
    }};
}
function render(report){
  const t=report.totals;
  const rows=report.routes.map(r=>'<tr><th scope="row">'+esc(r.routeId)+
    '<small>'+esc(r.method)+'</small></th><td>'+esc(r.http2xx)+'</td><td>'+
    esc(r.nativeSuccessEvents)+'</td><td>'+esc(r.acceptedByMerchantInbox)+'</td><td>'+
    esc(r.pendingDelivery)+'</td><td>'+esc(r.exhaustedDelivery)+'</td><td>'+
    esc(r.quotedUsd)+'</td></tr>').join('');
  const issues=report.issues.length?report.issues.map(i=>'<li><b>'+esc(i.routeId)+'</b>: '+
    esc(i.flag)+'</li>').join(''):'<li>No journal mismatches or pending callbacks in the matched window.</li>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'">'+
    '<meta name="robots" content="noindex,nofollow"><title>SF97 Native Merchant Settlement Ops</title>'+
    '<style>body{font:15px/1.5 system-ui,-apple-system,sans-serif;background:#f3f4f5;color:#1b252b;margin:0}'+
    'main{max-width:1120px;margin:auto;padding:32px 18px}header{border-bottom:2px solid #28343b;padding-bottom:18px}'+
    'h1{font-size:26px;margin:4px 0}h2{font-size:18px}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#58656b}'+
    '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card,.panel{background:white;border:1px solid #ccd4d9;border-radius:4px;padding:18px}'+
    '.card strong{font-size:24px;display:block}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}'+
    'th,td{text-align:right;border-bottom:1px solid #dce1e4;padding:12px}th:first-child{text-align:left}small{display:block;color:#5a6872}'+
    'ul{padding-left:22px}.muted{color:#53616a}.scroll{overflow-x:auto}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}}'+
    '@media print{body{background:white}main{padding:0}.card,.panel{break-inside:avoid}}</style></head>'+
    '<body><main><header><div class="eyebrow">Original SF30 × SF97 × SF98 | Private merchant operations</div><h1>'+
    esc(report.merchantName)+'</h1><div class="muted">Session '+esc(report.sessionId)+' | '+esc(report.sellerMode)+
    ' | '+esc(report.observedFrom)+' to '+esc(report.observedUntil)+'</div></header><section class="cards">'+
    [['Native success notices',t.alignedNativeSuccessEvents],['Delivered to inbox',t.deliveredToMerchantInbox],
    ['Pending callbacks',t.pendingDelivery],['Exhausted callbacks',t.exhaustedDelivery]].map(([label,value])=>
      '<div class="card"><span class="eyebrow">'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+
    '</section><section class="panel"><h2>Actual seller routes and original SF98 native events</h2><div class="scroll"><table>'+
    '<thead><tr><th>Route</th><th>HTTP 2xx</th><th>Native successes</th><th>Inbox accepted*</th><th>Retry queue</th><th>Exhausted</th><th>Owner USD quote</th></tr></thead><tbody>'+
    rows+'</tbody></table></div><p class="muted">*Original SF98 sender marked HTTP webhook acceptance; this does not establish merchant fulfillment. '+
    esc(t.outsideObservationWindow)+' native event(s) outside this SF30 snapshot window; '+
    esc(t.unmatchedEventIdentity)+' identity mismatches inside window.</p></section>'+
    '<section class="panel"><h2>Operator repair queue</h2><ul>'+issues+'</ul></section>'+
    '<section class="panel"><h2>Revenue and payment interpretation</h2><p>Original native SDK successful processSettlement is a separate observation from '+
    'HTTP 2xx, merchant inbox delivery, customer fulfillment, independently confirmed chain receipt, signed order, invoice, or revenue. '+
    'Owner price quotes remain scenario inputs only. Never multiply these event counts into booked cash without independent settlement and merchant accounting.</p></section>'+
    '<p class="muted">Generated '+esc(report.generatedAt)+' | Private offline read-only source reconciliation | No wallet, payments, Actions or network calls.</p></main></body></html>';
}
async function writeNew(path,files){
  if(!isAbsolute(path)||resolve(path)!==path)fail('ABSOLUTE_OUTPUT_DIRECTORY_REQUIRED');
  await mkdir(path,{recursive:false,mode:0o700});
  for(const [name,value] of Object.entries(files)){
    const handle=await open(join(path,name),'wx',0o600);
    try{await handle.writeFile(value);}finally{await handle.close();}
  }
}
export async function run({reportPath,outboxDir,outDir}){
  const stat=await lstat(outboxDir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
    fail('ORIGINAL_PRIVATE_SF98_OUTBOX_REQUIRED');
  const reportBytes=await strictFile(reportPath,2*1024*1024);
  const report=JSON.parse(reportBytes.toString('utf8'));
  const events=await journal(join(outboxDir,'events.ndjson'));
  const deliveries=await journal(join(outboxDir,'deliveries.ndjson'));
  const view=reconcile(report,events.rows,deliveries.rows);
  view.sourceSha256={sf97Report:sha(reportBytes),
    sf98EventsJournal:events.hash,sf98DeliveriesJournal:deliveries.hash};
  const reportOut=Buffer.from(JSON.stringify(view,null,2)+'\n');
  const page=Buffer.from(render(view));
  const summary=Buffer.from('# Original SF30 × SF97 × SF98 native merchant operations\n\n'+
    'Session: '+view.sessionId+'\nNative events matched: '+view.totals.alignedNativeSuccessEvents+
    '\nInbox accepted: '+view.totals.deliveredToMerchantInbox+
    '\n\n## Operator actions\n'+(view.issues.map(i=>'- [ ] '+i.routeId+': '+i.flag).join('\n')||
    '- [ ] Correlate native settlement, merchant order and independent chain evidence before invoicing')+
    '\n\nNo HTTP or callback observation is booked revenue.\n');
  const files={'native-ops.json':reportOut,'native-ops.html':page,'operator-actions.md':summary};
  files['manifest.json']=Buffer.from(JSON.stringify({
    schema:'stellar-forge.sf97-native-source-manifest.v1',sessionId:view.sessionId,
    sources:view.sourceSha256,files:Object.fromEntries(Object.entries(files).map(([name,b])=>
      [name,{sha256:sha(b),bytes:b.length}]))
  },null,2)+'\n');
  await writeNew(outDir,files);
  return {output:outDir,matchedNativeEvents:view.totals.alignedNativeSuccessEvents,
    originalEvents:view.totals.originalOutboxEvents,issues:view.issues.length};
}
function args(argv){
  const o={};
  for(let i=0;i<argv.length;i+=2){
    if(!['--report','--outbox','--out'].includes(argv[i])||
      !argv[i+1]||Object.hasOwn(o,argv[i]))fail('USAGE: --report SF97_REPORT --outbox ORIGINAL_SF98_OUTBOX_DIR --out NEW_PRIVATE_DIR');
    o[argv[i]]=argv[i+1];
  }
  if(!o['--report']||!o['--outbox']||!o['--out'])fail('REQUIRED_SOURCES_MISSING');
  return {reportPath:resolve(o['--report']),outboxDir:resolve(o['--outbox']),outDir:resolve(o['--out'])};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  run(args(process.argv.slice(2))).then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
    .catch(error=>{process.stderr.write('SF97_NATIVE: '+error.message+'\n');process.exitCode=1;});
}
