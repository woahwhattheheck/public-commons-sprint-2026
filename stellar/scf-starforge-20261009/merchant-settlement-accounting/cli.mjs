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
  const {totals:t,routes,options,ledger,exceptions,hashes}=r;
  const style=`:root{color-scheme:light;font:14px/1.48 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17212b;background:#f4f5f6}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 24px 68px}header{border-bottom:2px solid #263340;padding:0 0 20px;margin-bottom:24px}h1{font-size:26px;letter-spacing:-.045em;margin:2px 0 5px}h2{font-size:17px;margin:36px 0 12px}small,.muted{color:#596777}.kicker{text-transform:uppercase;font-size:11px;letter-spacing:.14em;font-weight:700;color:#515f6d}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.stat,.panel{border:1px solid #c8cfd4;background:#fff;border-radius:4px;padding:15px}.stat strong{display:block;font-size:23px;letter-spacing:-.04em}.stat span{display:block;color:#596777;font-size:12px}.panel{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:#4b5967;background:#f1f3f4;text-align:left}th,td{padding:10px 11px;border-bottom:1px solid #e3e6e8;vertical-align:top}tr:last-child td{border-bottom:0}td code{font:11px ui-monospace,monospace;overflow-wrap:anywhere}.good{font-weight:700}.bad{color:#7d372b;font-weight:700}.foot{padding:16px;border-left:3px solid #4d5b69;background:#e8ebed;margin-top:26px;font-size:12px;line-height:1.65}@media(max-width:760px){main{padding:20px 13px 48px}.stats{grid-template-columns:repeat(2,1fr)}h1{font-size:23px}table{min-width:650px}}@media print{body{background:#fff}main{max-width:none}.panel,.stat{break-inside:avoid}}`;
  const optionStyle=`.option{border:1px solid #c8cfd4;background:#fff;margin:14px 0;padding:18px;border-radius:4px;scroll-margin-top:20px}.option h3{font-size:15px;margin:0 0 4px}.option .terms{display:grid;grid-template-columns:170px minmax(0,1fr);gap:7px 14px;font-size:12px;margin:16px 0}.terms dt{color:#596777}.terms dd{margin:0;overflow-wrap:anywhere}.terms code{font:11px ui-monospace,monospace}.option .panel{padding:0;border:0}.option .panel+ .panel{margin-top:14px}td.digest{max-width:160px;overflow-wrap:anywhere;font:11px ui-monospace,monospace}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:2px}.empty{color:#596777;padding:12px}@media(max-width:760px){.option{padding:13px}.option .terms{grid-template-columns:1fr;gap:4px}.terms dd{margin-bottom:8px}}@media print{.option{break-inside:avoid}}`;
  const table=(data,columns)=>'<div class="panel"><table><thead><tr>'+columns.map(([k,label])=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+data.map(x=>'<tr>'+columns.map(([k])=>'<td'+(/(?:Id|Digest)$/.test(k)?' class="digest"':'')+'>'+(k==='optionId'?'<a href="#option-'+esc(x[k])+'">'+esc(x[k])+'</a>':esc(x[k]??''))+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+(data.length?'':'<p class="empty">No rows.</p>')+'</div>';
  const short=x=>typeof x==='string'&&x.length>17?x.slice(0,12)+'…':x;
  const ledgerView=ledger.map(x=>({...x,at:x.at.slice(0,19).replace('T',' '),eventId:short(x.eventId),termsMatch:x.termsMatch.replace(/_/g,' '),transfer:x.transfer.replace(/_/g,' '),delivery:x.delivery.replace(/_/g,' '),quoted:x.verifiedQuotedValueUsd??'—'}));
  const exceptionsView=exceptions.map(x=>({...x,eventId:short(x.eventId),reason:x.reason.replace(/_/g,' ')}));
  const optionCards=options.map(option=>{
    const values=[['Option ID',option.optionId],['Network',option.network],['Atomic amount per event',option.amountAtomic],
      ['Asset digest',option.assetDigest],['Recipient digest',option.recipientDigest??'Not recorded; unresolved recipient group'],
      ['Merchant USD quote',option.merchantQuoteUsd??'Unknown'],['Merchant variable cost USD',option.merchantVariableCostUsd??'Unknown'],
      ['Merchant price basis',option.merchantPriceBasis??'Unconfigured']];
    return '<section class="option" id="option-'+esc(option.optionId)+'"><h3>'+esc(option.method)+' '+esc(option.routeId)+'</h3><div class="muted">'+(option.configuredOption?'Configured payment option':'Unconfigured or unresolved native option')+'</div><dl class="terms">'+values.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd><code>'+esc(value)+'</code></dd>').join('')+'</dl>'+
      table([option],[['nativeSuccessEvents','Native events'],['officialTransferMatches','Official matches'],['missingTransferEvidence','Unmatched'],['webhookAccepted','Webhook accepted'],['legacyRecipientEvents','Recipient not recorded'],['unresolvedTermsEvents','Terms unresolved']])+
      table([option],[['nativeAmountAtomic','Native reported atomic total'],['officialMatchedAmountAtomic','Official matched atomic total'],['verifiedQuotedValueUsd','Owner-quoted USD, verified-tier only']])+'</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Merchant Reconciliation</title><style>'+style+optionStyle+'</style></head><body><main><header><div class="kicker">Private owner operations · Stellar x402</div><h1>Merchant settlement reconciliation</h1><div class="muted">Original native SF98 events joined to original SF86 network-specific RPC proof files. Generated '+esc(r.createdAt)+'</div></header>'+
  '<section class="stats"><div class="stat"><strong>'+t.nativeSuccessEvents+'</strong><span>Native seller successes</span></div><div class="stat"><strong>'+t.officialTransferMatches+'</strong><span>Official transfer matches</span></div><div class="stat"><strong>'+t.requiringReconciliation+'</strong><span>Require reconciliation</span></div><div class="stat"><strong>'+t.webhookAccepted+'</strong><span>Webhook acknowledgments, not fulfillment</span></div></section>'+
  '<div class="foot"><b>Accounting boundary.</b> The official transfer column follows the original SF86 verifier and accounting engine for each recorded network. Eligible proof must match that network and the original payment option; each event retains its verification scope. A matched transfer for a seller-reported hash does not independently prove buyer entitlement, final accounting recognition, net revenue, tax, fiat conversion, refund status, invoices, or bank settlement. The merchant-supplied USD quote is NOT cash booked. Challenge-only HTTP 402 or 2xx are excluded entirely.</div>'+
  '<h2>Route reconciliation</h2>'+table(routes,[['routeId','Route'],['method','Method'],['nativeSuccessEvents','Native successes'],['officialTransferMatches','RPC transfer matches'],['missingTransferEvidence','Unmatched'],['webhookAccepted','Webhook accepted'],['verifiedQuotedValueUsd','Owner-quoted USD, verified-tier only']])+
  '<h2>Payment option reconciliation</h2><p class="muted">Every configured option and every unresolved native option group appears below. Atomic totals stay within one route, method, network, asset, amount and recipient. Public-network events pending verification: '+t.publicNetworkPending+'. Legacy events matching multiple recipient options: '+t.ambiguousLegacyEvents+'. Events with unresolved merchant terms: '+t.unresolvedTermsEvents+'.</p>'+optionCards+
  '<h2>Event ledger</h2>'+table(ledgerView,[['at','Timestamp UTC'],['eventId','Event'],['routeId','Route'],['method','Method'],['network','Network'],['amountAtomic','Atomic amount'],['optionId','Payment option'],['termsMatch','Terms mapping'],['transfer','Transfer evidence'],['delivery','Webhook state'],['quoted','USD quote, not revenue']])+
  '<h2>Operator exceptions ('+exceptions.length+')</h2>'+table(exceptionsView,[['eventId','Event'],['routeId','Route'],['method','Method'],['network','Network'],['optionId','Payment option'],['reason','Reason']])+
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
export async function writeOriginalAccountingPack(result,out){
  if(!isAbsolute(out)||resolve(out)!==out||out==='/')throw new Error('ABSOLUTE_NORMALIZED_OUTPUT_REQUIRED');
  // No replacing or filling pre-existing directories; owner chooses a fresh path.
  await mkdir(out,{recursive:false,mode:0o700});
  const info=await stat(out);if((info.mode&0o077)!==0)throw new Error('OUTPUT_DIRECTORY_NOT_PRIVATE');
  const fields=['eventId','at','routeId','method','network','amountAtomic','assetDigest','receiptFingerprint','transactionFingerprint','orderReferenceDigest','transferEvidenceDigest','ledger','matchingEventDigest','transfer','delivery','exception','merchantQuoteUsd','merchantVariableCostUsd','verifiedQuotedValueUsd',
    'recipientDigest','termsRecipientDigest','optionId','termsMatch','termsCandidateCount','merchantPriceBasis','verificationScope'];
  const optionFields=['optionId','routeId','method','network','assetDigest','amountAtomic','recipientDigest','configuredOption',
    'merchantQuoteUsd','merchantVariableCostUsd','merchantPriceBasis','nativeSuccessEvents','officialTransferMatches',
    'missingTransferEvidence','webhookAccepted','legacyRecipientEvents','unresolvedTermsEvents','nativeAmountAtomic','officialMatchedAmountAtomic','verifiedQuotedValueUsd'];
  const files=new Map([
    ['report.json',JSON.stringify(result,null,2)+'\n'],
    ['ledger.csv',csv(result.ledger,fields)],
    ['exceptions.csv',csv(result.exceptions,['eventId','routeId','reason','method','network','optionId','termsMatch'])],
    ['review.html',page(result)],
    ['options.csv',csv(result.options,optionFields)],
  ]);
  for(const [name,content] of files)await writePrivate(join(out,name),content);
  const manifest={schema:'stellar-forge.merchant-accounting-manifest.v1',sourceHashes:result.hashes,
    outputs:[...files].map(([name,content])=>({name,sha256:sha(content),bytes:Buffer.byteLength(content)}))};
  await writePrivate(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {schema:result.schema,output:out,totals:result.totals,exceptions:result.exceptions.length,manifestSha256:sha(JSON.stringify(manifest,null,2)+'\n')};
}
export async function main(argv=process.argv.slice(2)){
  const a=argsOf(argv);
  const result=await runOriginalAccounting({outboxDir:a['--outbox'],proofDir:a['--proof-dir'],termsFile:a['--terms']});
  const output=await writeOriginalAccountingPack(result,a['--out']);
  process.stdout.write(JSON.stringify(output)+'\n');
  return 0;
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error(e?.message??String(e));process.exitCode=1;});
