#!/usr/bin/env node
// MIT. Read-only SCF SF98 merchant settlement operations -> local accounting pack.
import { createHash } from 'node:crypto';
import { mkdir, open, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { runOriginalAccounting } from './reconcile.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function csvCell(x) {
  if(x===undefined||x===null) return '';
  let s=String(x);
  if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
const csv=(rows,cols)=>[cols.join(','),...rows.map(row=>cols.map(k=>csvCell(row[k])).join(','))].join('\r\n')+'\r\n';
function page(r) {
  const {totals:t,routes,ledger,exceptions,hashes}=r;
  const style=`:root{color-scheme:light;font:14px/1.48 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17212b;background:#f4f5f6}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 24px 68px}header{border-bottom:2px solid #263340;padding:0 0 20px;margin-bottom:24px}h1{font-size:26px;letter-spacing:-.045em;margin:2px 0 5px}h2{font-size:17px;margin:36px 0 12px}small,.muted{color:#596777}.kicker{text-transform:uppercase;font-size:11px;letter-spacing:.14em;font-weight:700;color:#515f6d}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.stat,.panel{border:1px solid #c8cfd4;background:#fff;border-radius:4px;padding:15px}.stat strong{display:block;font-size:23px;letter-spacing:-.04em}.stat span{display:block;color:#596777;font-size:12px}.panel{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:#4b5967;background:#f1f3f4;text-align:left}th,td{padding:10px 11px;border-bottom:1px solid #e3e6e8;vertical-align:top}tr:last-child td{border-bottom:0}td code{font:11px ui-monospace,monospace;overflow-wrap:anywhere}.good{font-weight:700}.bad{color:#7d372b;font-weight:700}.foot{padding:16px;border-left:3px solid #4d5b69;background:#e8ebed;margin-top:26px;font-size:12px;line-height:1.65}@media(max-width:760px){main{padding:20px 13px 48px}.stats{grid-template-columns:repeat(2,1fr)}h1{font-size:23px}table{min-width:650px}}@media print{body{background:#fff}main{max-width:none}.panel,.stat{break-inside:avoid}}`;
  const table=(data,columns)=>'<div class="panel"><table><thead><tr>'+columns.map(([k,label])=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+data.map(x=>'<tr>'+columns.map(([k])=>'<td>'+esc(x[k]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const short=x=>typeof x==='string'&&x.length>17?x.slice(0,12)+'…':x;
  const ledgerView=ledger.map(x=>({at:x.at.slice(0,19).replace('T',' '),eventId:short(x.eventId),routeId:x.routeId,method:x.method,transfer:x.transfer.replace(/_/g,' '),delivery:x.delivery.replace(/_/g,' '),quoted:x.verifiedQuotedValueUsd??'—'}));
  const exceptionsView=exceptions.map(x=>({eventId:short(x.eventId),routeId:x.routeId,reason:x.reason.replace(/_/g,' ')}));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Merchant Reconciliation</title><style>'+style+'</style></head><body><main><header><div class="kicker">Private owner operations · Stellar x402</div><h1>Merchant settlement reconciliation</h1><div class="muted">Original native SF98 events joined to original SF86 official testnet RPC proof files. Generated '+esc(r.createdAt)+'</div></header>'+
  '<section class="stats"><div class="stat"><strong>'+t.nativeSuccessEvents+'</strong><span>Native seller successes</span></div><div class="stat"><strong>'+t.officialTransferMatches+'</strong><span>Official transfer matches</span></div><div class="stat"><strong>'+t.requiringReconciliation+'</strong><span>Require reconciliation</span></div><div class="stat"><strong>'+t.webhookAccepted+'</strong><span>Webhook acknowledgments, not fulfillment</span></div></section>'+
  '<div class="foot"><b>Accounting boundary.</b> Only original SF86 <code>CHAIN_TRANSFER_MATCHED_RPC_TESTNET</code> results are eligible for the official transfer column. These verify a matching testnet transfer for a seller-reported hash. They do not independently prove buyer entitlement, final accounting recognition, net revenue, tax, fiat conversion, refund status, invoices, or bank settlement. The merchant-supplied USD quote is NOT cash booked. Challenge-only HTTP 402 or 2xx are excluded entirely.</div>'+
  '<h2>Route reconciliation</h2>'+table(routes,[['routeId','Route'],['method','Method'],['nativeSuccessEvents','Native successes'],['officialTransferMatches','RPC transfer matches'],['missingTransferEvidence','Unmatched'],['webhookAccepted','Webhook accepted'],['verifiedQuotedValueUsd','Owner-quoted USD, verified-tier only']])+
  '<h2>Event ledger</h2>'+table(ledgerView,[['at','Timestamp UTC'],['eventId','Event'],['routeId','Route'],['method','Method'],['transfer','Transfer evidence'],['delivery','Webhook state'],['quoted','USD quote, not revenue']])+
  '<h2>Operator exceptions ('+exceptions.length+')</h2>'+table(exceptionsView,[['eventId','Event'],['routeId','Route'],['reason','Reason']])+
  '<h2>Source lineage</h2><div class="panel"><p>Original SF98 events SHA-256: <code>'+esc(hashes.originalSf98EventsSha256??'NO_EVENT_FILE')+'</code></p><p>Original SF98 delivery journal SHA-256: <code>'+esc(hashes.originalSf98DeliveriesSha256??'NO_DELIVERY_FILE')+'</code></p><p>Owner terms SHA-256: <code>'+esc(hashes.termsSha256)+'</code></p><p>Original SF86 evidence result files: '+r.hashes.originalSf86ProofSha256.length+'; ignored/not-live: '+r.ignoredProofs.length+'; official proofs without counted matched event: '+r.unmatchedOfficialProofCount+'</p></div>'+
  '<p class="muted"><small>No scripts, webfonts, tracking, remote requests, raw wallets, order references or purchaser details. Keep this directory private.</small></p></main></body></html>';
}
function argsOf(argv) {
  if(argv.length!==8) throw new Error('Usage: node cli.mjs --outbox /private/sf98 --proof-dir /private/sf86-results --terms /private/prices.json --out /private/new-accounting-pack');
  const valid=new Set(['--outbox','--proof-dir','--terms','--out']),opts={};
  for(let i=0;i<argv.length;i+=2){if(!valid.has(argv[i])||opts[argv[i]]!==undefined||!argv[i+1])throw new Error('INVALID_OR_DUPLICATE_CLI_OPTION');opts[argv[i]]=argv[i+1];}
  if(Object.keys(opts).length!==4)throw new Error('MISSING_REQUIRED_OPTION');
  for(const v of Object.values(opts)) if(!isAbsolute(v)||resolve(v)!==v||v==='/')throw new Error('ABSOLUTE_NORMALIZED_PATHS_REQUIRED');
  if(new Set([opts['--outbox'],opts['--proof-dir'],opts['--out'],opts['--terms']]).size!==4)throw new Error('INPUT_OUTPUT_MUST_BE_DISTINCT');
  for(const key of ['--outbox','--proof-dir']){
    const root=opts[key];if(opts['--out'].startsWith(root+'/'))throw new Error('OUTPUT_CANNOT_BE_INSIDE_PRIVATE_INPUTS');
  }
  return opts;
}
async function writePrivate(path,data){
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(data,'utf8');await handle.sync();}
  finally{await handle.close();}
}
export async function main(argv=process.argv.slice(2)){
  const a=argsOf(argv);
  const result=await runOriginalAccounting({outboxDir:a['--outbox'],proofDir:a['--proof-dir'],termsFile:a['--terms']});
  const out=a['--out'];
  // No replacing or filling pre-existing directories; owner chooses a fresh path.
  await mkdir(out,{recursive:false,mode:0o700});
  const info=await stat(out);if((info.mode&0o077)!==0)throw new Error('OUTPUT_DIRECTORY_NOT_PRIVATE');
  const fields=['eventId','at','routeId','method','network','amountAtomic','assetDigest','receiptFingerprint','transactionFingerprint','orderReferenceDigest','transferEvidenceDigest','ledger','matchingEventDigest','transfer','delivery','exception','merchantQuoteUsd','merchantVariableCostUsd','verifiedQuotedValueUsd'];
  const files=new Map([
    ['report.json',JSON.stringify(result,null,2)+'\n'],
    ['ledger.csv',csv(result.ledger,fields)],
    ['exceptions.csv',csv(result.exceptions,['eventId','routeId','reason'])],
    ['review.html',page(result)],
  ]);
  for(const [name,content] of files)await writePrivate(join(out,name),content);
  const manifest={schema:'stellar-forge.merchant-accounting-manifest.v1',sourceHashes:result.hashes,
    outputs:[...files].map(([name,content])=>({name,sha256:sha(content),bytes:Buffer.byteLength(content)}))};
  await writePrivate(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify({schema:result.schema,output:out,totals:result.totals,exceptions:result.exceptions.length,manifestSha256:sha(JSON.stringify(manifest,null,2)+'\n')})+'\n');
  return 0;
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error(e?.message??String(e));process.exitCode=1;});
