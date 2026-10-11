#!/usr/bin/env node
// SF97: Private merchant pilot conversion room. No network, send, payment or wallet actions.
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze, parseMicroUsd, formatUsd} from '../sf87-rail-unit-economics/compare.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const fail = m => {throw Error(`SF97: ${m}`)};
const check = (p,m) => {if(!p) fail(m)};
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const dec = v => typeof v === 'string' && /^(0|[1-9]\d*)(\.\d{1,6})?$/.test(v);
const ident = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(v);
const note = (v,max=300) => typeof v === 'string' && v.trim().length>0 && v.length<=max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
const url = v => {try {const u=new URL(v);return u.protocol==='https:' && !!u.hostname && !u.username && !u.password} catch{return false}};
const exactKeys = (got,want) => JSON.stringify(got)===JSON.stringify(want);
const html = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function fileBytes(file,max=3_000_000) {
  const s=await stat(file);check(s.isFile()&&s.size>0&&s.size<=max,`file size/type invalid: ${file}`);
  const b=await readFile(file);check(b.length<=max,`file changed while reading: ${file}`);return b;
}
const json = b => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
function args(argv) {
  const [action,...rest]=argv;
  check(['build','finalize'].includes(action),'usage: room.mjs build --bundle DIR --scenario FILE --terms FILE --out NEW_DIR | finalize --case DIR --review FILE --out NEW_DIR');
  const out={};
  for(let i=0;i<rest.length;i+=2){check(/^--[a-z]+$/.test(rest[i])&&rest[i+1]&&!rest[i+1].startsWith('--')&&!Object.hasOwn(out,rest[i]),'invalid or duplicate flag');out[rest[i]]=rest[i+1]}
  const expected=action==='build'?['--bundle','--scenario','--terms','--out']:['--case','--review','--out'];
  check(exactKeys(Object.keys(out).sort(),expected.sort()),'missing or unexpected flags');return {action,out};
}
function termsCheck(t) {
  check(obj(t)&&t.schema==='stellar-forge.pilot-conversion-terms.v1','operator terms schema');
  check(ident(t.pilotId)&&note(t.merchantName,160)&&note(t.relationshipOwner,160),'pilot ID / merchant / owner');
  check(['NOT_RECORDED','OWNER_CONFIRMED'].includes(t.merchantConsent?.status),'merchant consent state');
  if(t.merchantConsent.status==='OWNER_CONFIRMED')check(url(t.merchantConsent.receiptUrl),'merchant consent HTTPS receipt');
  const c=t.commercial;check(obj(c)&&['NOT_APPROVED','OWNER_APPROVED_QUOTE'].includes(c.approval),'commercial approval state');
  if(c.approval==='OWNER_APPROVED_QUOTE'){
    check(dec(c.feeUsd)&&dec(c.estimatedDeliveryCostUsd)&&url(c.approvalReceipt),'approved quote needs actual approval link and exact USD strings');
    check(parseMicroUsd(c.feeUsd,'fee')>=parseMicroUsd(c.estimatedDeliveryCostUsd,'estimated delivery cost'),'approved fee below estimated cost');
  } else check([null,undefined].includes(c.feeUsd)&&[null,undefined].includes(c.estimatedDeliveryCostUsd),'unapproved terms cannot present fee or cost as approved');
  check(Array.isArray(t.milestones)&&t.milestones.length>=2&&t.milestones.length<=30,'two to thirty milestones required');
  let ids=new Set();for(const m of t.milestones){check(ident(m.id)&&!ids.has(m.id)&&note(m.title,160)&&note(m.acceptance,1000)&&note(m.owner,160),'milestone ID/title/acceptance/owner');ids.add(m.id)}
}
function bundleCheck(b,m,bytes) {
  check(b?.schema==='stellar-forge.seller-support.v1'&&m?.schema==='stellar-forge.seller-support-manifest.v1','original SF93 evidence schemas');
  check(m.sessionId===b.observation?.sessionId&&m.files?.['bundle.json']?.sha256===sha(bytes),'SF93 bundle-to-manifest SHA/session mismatch');
  check(b.seller?.mode==='CHALLENGE_ONLY'||b.seller?.mode==='NATIVE_X402','original seller mode');
  check(Array.isArray(b.observation.routes)&&Array.isArray(b.alerts),'original observation/alerts');
  const x=b.observation.totals;check(obj(x),'original totals');
  for(const k of ['started','completed','responses','success','challenge','serverError','disconnected','inFlight']) check(Number.isSafeInteger(x[k])&&x[k]>=0,'invalid original count '+k);
  check(x.responses+x.disconnected===x.completed&&x.completed+x.inFlight===x.started,'original counters inconsistent');
  check(b.observation.routes.length<=103&&b.seller.advertisedRoutes?.length<=64,'excessive original routes');
}
async function writeNew(dir, files) {
  const dest=resolve(dir);check(dest!=='/'&&dest!==process.cwd()&&dest!==dirname(dest),'unsafe output directory');
  await mkdir(dest,{mode:0o700}); // must be new, no replacement
  for(const [name,bytes] of Object.entries(files))await writeFile(join(dest,name),bytes,{flag:'wx',mode:0o600});
  return dest;
}
function reviewPage(d,caseSha) {
  const milestones=d.milestones.map(m=>`<tr><td><strong>${html(m.id)}</strong><small>${html(m.owner)}</small></td><td><b>${html(m.title)}</b><p>${html(m.acceptance)}</p></td><td><select data-id="${html(m.id)}"><option>OPEN</option><option>NEEDS_CHANGES</option><option>ACCEPTED</option></select><input data-evidence="${html(m.id)}" placeholder="Evidence URL or file SHA-256" aria-label="Evidence for ${html(m.id)}"></td></tr>`).join('');
  const rails=d.economics.rails.map(r=>`<tr><td>${html(r.label)}</td><td>${html(r.modeledTotalCostUsd??'Unknown')}</td><td>${html(r.netContributionUsd??'Unknown')}</td><td>${html(r.breakEvenPaidRequestsMonth??'Not calculable')}</td></tr>`).join('');
  const scriptData=JSON.stringify({pilotId:d.pilotId,caseSha,milestones:d.milestones.map(({id})=>({id}))}).replace(/[<>&\u2028\u2029]/g,c=>`\\u${c.codePointAt(0).toString(16).padStart(4,'0')}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'"><title>SF97 | ${html(d.pilotId)}</title><style>:root{color-scheme:light;font:15px system-ui,-apple-system,sans-serif;background:#f3f4f5;color:#1b262a}*{box-sizing:border-box}body{max-width:1220px;margin:auto;padding:22px}header{display:flex;gap:24px;justify-content:space-between;align-items:baseline;border-bottom:2px solid #263439;padding-bottom:15px}h1{font-size:23px;margin:4px 0}h2{font-size:18px}p{line-height:1.5}small,.muted{display:block;color:#627078;font-size:12px;margin-top:5px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#52616a}.tag{padding:5px 9px;border:1px solid #b5c0c4;border-radius:4px;background:white;font-size:12px}.panel{border:1px solid #d3dadd;background:#fff;padding:18px;margin:17px 0;border-radius:5px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px}.metric{border:1px solid #d6dcde;background:#fafbfb;padding:15px}.metric strong{display:block;font-size:24px;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:12px 8px;border-bottom:1px solid #e0e4e5}th{font-size:12px;color:#536269}td small{max-width:180px}input,select,button{font:inherit;border-radius:4px;border:1px solid #a9b4b8;padding:10px;background:white;color:#1b262a}input{width:100%}select{width:100%;margin-bottom:6px}button{cursor:pointer;border-color:#263c47;background:#263c47;color:white}button.ghost{background:white;color:#263c47}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #727f88}footer{padding:20px 0;color:#637078}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.actions input{max-width:220px}.note{border-left:3px solid #84939a;padding:10px;background:#f8f9f9}@media(max-width:700px){body{padding:12px}header{display:block}table{display:block;overflow:auto;white-space:normal}.grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><header><div><div class="label">Stellar Commerce · Private pilot conversion</div><h1>${html(d.merchantName)}</h1><span class="muted">${html(d.pilotId)} · Owner: ${html(d.relationshipOwner)}</span></div><span class="tag">${html(d.commercial.approval)}</span></header><section class="panel"><h2>Observed service session</h2><div class="grid">${[['HTTP attempts',d.runtime.started],['HTTP 402 challenges',d.runtime.challenge],['HTTP 2xx',d.runtime.success],['HTTP 5xx',d.runtime.serverError],['Disconnects',d.runtime.disconnected],['Session mode',d.runtime.mode]].map(([t,v])=>`<div class="metric"><span class="label">${html(t)}</span><strong>${html(v)}</strong></div>`).join('')}</div><p class="muted">Source session ${html(d.runtime.sessionId)}; observed ${html(d.runtime.capturedAt)}. These are HTTP outcomes, not paid transactions.</p><p>${html(d.runtime.alerts.join(' · '))}</p></section><section class="panel"><h2>Conditional rail economics</h2><p>Original SF87 engine; operator-entered future workload, not observed from these HTTP requests. Monthly scenario ${html(d.economics.workload.paidRequestsMonth)} paid calls at $${html(d.economics.workload.pricePerPaidRequestUsd)} each.</p><table><thead><tr><th>Rail</th><th>Monthly cost USD</th><th>Contribution USD</th><th>Break-even calls</th></tr></thead><tbody>${rails}</tbody></table><p class="note">Unknown costs stay unknown. Session liquidity is separate from operating cost. No rail selected or payment authorized by this page.</p></section><section class="panel"><h2>Commercial and delivery</h2><p>Merchant consent: <b>${html(d.merchantConsent)}</b> · Approved proposed fee: <b>${html(d.commercial.approvedFeeUsd??'Not approved')}</b> · Estimated delivery cost: <b>${html(d.commercial.estimatedDeliveryCostUsd??'Not approved')}</b></p><p class="muted">An approved quote is not a signed contract or collected payment.</p><h2>Milestone acceptance desk</h2><p>Record specific reviewer decisions and independent evidence, then download a private review file. You can reload that review without an account or server.</p><div class="actions"><input id="reviewer" placeholder="Reviewer name" aria-label="Reviewer name"><button id="export">Export review</button><button id="load" class="ghost">Load saved review</button><input id="upload" type="file" accept="application/json" hidden></div><p id="message" role="status"></p><table><thead><tr><th>Owner / ID</th><th>Acceptance scope</th><th>Decision / source</th></tr></thead><tbody>${milestones}</tbody></table></section><footer>Private create-only case. Source bundle SHA-256 ${html(d.sources.bundleSha256)}. No network or payment execution.</footer><script id="case-data" type="application/json">${scriptData}</script><script src="./review.js" defer></script></body></html>`;
}
async function build(p) {
  const bundleDir=resolve(p['--bundle']);
  const [bbytes,mbytes,sbytes,tbytes]=await Promise.all([fileBytes(join(bundleDir,'bundle.json')),fileBytes(join(bundleDir,'manifest.json')),fileBytes(p['--scenario']),fileBytes(p['--terms'])]);
  const b=json(bbytes),m=json(mbytes),s=json(sbytes),t=json(tbytes);
  bundleCheck(b,m,bbytes);termsCheck(t);
  const economics=analyze(s); // MUST use original SF87 source, never recreate fee math
  const c=t.commercial, quote=c.approval==='OWNER_APPROVED_QUOTE';
  const profit=quote?formatUsd(parseMicroUsd(c.feeUsd,'fee')-parseMicroUsd(c.estimatedDeliveryCostUsd,'cost')):null;
  const d={schema:'stellar-forge.pilot-conversion-room.v1',generatedAt:new Date().toISOString(),pilotId:t.pilotId,merchantName:t.merchantName,relationshipOwner:t.relationshipOwner,merchantConsent:t.merchantConsent.status,
    sources:{bundleSha256:sha(bbytes),bundleManifestSha256:sha(mbytes),scenarioSha256:sha(sbytes),termsSha256:sha(tbytes)},
    runtime:{sessionId:b.observation.sessionId,capturedAt:b.observation.capturedAt,mode:b.seller.mode,started:b.observation.totals.started,success:b.observation.totals.success,challenge:b.observation.totals.challenge,serverError:b.observation.totals.serverError,disconnected:b.observation.totals.disconnected,observerErrors:b.observation.observerErrors,alerts:b.alerts},
    economics,commercial:{approval:c.approval,approvedFeeUsd:quote?c.feeUsd:null,estimatedDeliveryCostUsd:quote?c.estimatedDeliveryCostUsd:null,modeledDeliveryContributionUsd:profit,approvalReceipt:quote?c.approvalReceipt:null},
    milestones:t.milestones.map(m=>({id:m.id,title:m.title,owner:m.owner,acceptance:m.acceptance,status:'OPEN'})),boundaries:{customerSigned:false,invoiceIssued:false,paidRevenueObserved:false,onchainSettlementObserved:false,remoteCalls:0}}
  const cbytes=Buffer.from(JSON.stringify(d,null,2)+'\n'),caseSha=sha(cbytes),ui=Buffer.from(reviewPage(d,caseSha));
  const js=await fileBytes(new URL('./review.js',import.meta.url).pathname,80_000);
  const files={'case.json':cbytes,'index.html':ui,'review.js':js};
  files['manifest.json']=Buffer.from(JSON.stringify({schema:'stellar-forge.pilot-room-manifest.v1',pilotId:t.pilotId,caseSha256:caseSha,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{sha256:sha(v),bytes:v.length}])),originalSources:d.sources},null,2)+'\n');
  const out=await writeNew(p['--out'],files);return {out,pilotId:d.pilotId,caseSha256:caseSha,files:Object.keys(files),milestones:d.milestones.length,approval:c.approval};
}
async function finalize(p) {
  const dir=resolve(p['--case']);const [cb,mb,rb]=await Promise.all([fileBytes(join(dir,'case.json')),fileBytes(join(dir,'manifest.json')),fileBytes(p['--review'],200_000)]);
  const c=json(cb),m=json(mb),r=json(rb);
  check(c?.schema==='stellar-forge.pilot-conversion-room.v1'&&m?.schema==='stellar-forge.pilot-room-manifest.v1','original case/manifest schema');
  check(m.caseSha256===sha(cb)&&m.files?.['case.json']?.sha256===sha(cb),'case changed after publishing');
  check(r?.schema==='stellar-forge.pilot-conversion-review.v1'&&r.caseSha256===sha(cb)&&r.pilotId===c.pilotId,'review targets a different case');
  check(note(r.reviewer,160)&&Array.isArray(r.decisions)&&r.decisions.length===c.milestones.length,'reviewer/decision count');
  const ids=c.milestones.map(x=>x.id);
  check(exactKeys(r.decisions.map(x=>x.id),ids),'milestone identity or order changed');
  for(const x of r.decisions){check(['OPEN','NEEDS_CHANGES','ACCEPTED'].includes(x.status),'invalid decision status');check(typeof x.evidence==='string'&&x.evidence.length<=2048,'evidence length');if(x.status==='ACCEPTED')check(url(x.evidence)||/^sha256:[a-f0-9]{64}$/i.test(x.evidence),'accepted milestone needs original HTTPS receipt or sha256 digest')}
  const done=r.decisions.filter(x=>x.status==='ACCEPTED').length;
  const artifact={schema:'stellar-forge.pilot-conversion-decision.v1',finalizedAt:new Date().toISOString(),pilotId:c.pilotId,reviewer:r.reviewer,caseSha256:sha(cb),reviewSha256:sha(rb),accepted:done,total:ids.length,status:done===ids.length?'ALL_TECHNICAL_MILESTONES_REVIEWED':'PARTIAL_REVIEW',decisions:r.decisions,
    commercialApproval:c.commercial.approval,merchantConsent:c.merchantConsent,limitations:{noSignedContractInferred:true,noInvoiceIssued:true,noPaymentInferred:true}};
  const summary=`# ${c.pilotId} · Operator review\n\nReviewer: ${r.reviewer}\nAccepted technical milestones: ${done}/${ids.length}\nStatus: ${artifact.status}\nOriginal case SHA-256: ${sha(cb)}\nOriginal review SHA-256: ${sha(rb)}\n\n${r.decisions.map(x=>`- ${x.id}: ${x.status}; evidence ${x.evidence||'NOT_SUPPLIED'}`).join('\n')}\n\nA reviewed technical milestone alone is not buyer signoff, signed contract, invoice or received funds.\n`;
  const out=await writeNew(p['--out'],{'decision.json':Buffer.from(JSON.stringify(artifact,null,2)+'\n'),'review.md':Buffer.from(summary)});
  return {out,pilotId:c.pilotId,status:artifact.status,accepted:done,total:ids.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const p=args(process.argv.slice(2));const result=await (p.action==='build'?build(p.out):finalize(p.out));console.log(JSON.stringify(result,null,2))}
  catch(e){console.error(e.message);process.exitCode=1}
}
