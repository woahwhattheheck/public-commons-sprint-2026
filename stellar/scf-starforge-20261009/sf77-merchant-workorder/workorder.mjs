#!/usr/bin/env node
// MIT. Local-only commercial handoff from the ORIGINAL SF70 merchant intake, with no network or payments.
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare} from '../sf76-merchant-remediation-delta/compare.mjs';

const SCHEMA = 'SCF-SF77/merchant-workorder-v1';
const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest = raw => createHash('sha256').update(raw).digest('hex');
const ensure = (condition, message) => {if (!condition) throw Error(message);};
const https = value => {try {const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;} catch{return false;}};
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
const usd = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const fmt = value => value === null ? 'WITHHELD UNTIL OWNER APPROVES' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const modeLabel = mode => mode === true ? 'Credentialed browser policy' : mode === false ? 'Noncredentialed browser policy' : 'UNKNOWN — original evidence does not establish the mode';
const changeGroups = [
  ['notReobservedWithCompleteAfterCatalog','Not reobserved · complete after catalog and matching credential mode'],
  ['notReobservedButAfterCatalogIncomplete','Not reobserved · catalog coverage incomplete; closure unconfirmed'],
  ['notReobservedButCredentialModeUnknown','Not reobserved · credential mode unknown; closure unconfirmed'],
  ['newlyObserved','Newly observed'], ['stillObserved','Still observed'], ['severityChanged','Severity changed']
];

async function smallJson(file, maxBytes=5*1024*1024) {
  const s = await stat(file);
  ensure(s.isFile() && s.size > 0 && s.size <= maxBytes, `JSON input must be a regular file of 1..${maxBytes} bytes`);
  const raw = await readFile(file);
  ensure(raw.length > 0 && raw.length <= maxBytes, 'JSON input changed size while reading');
  return {raw, doc: JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
}

export function buildPacket(intake, terms, inputHash, generatedAt, recheck=null) {
  ensure(intake?.schema === 'stellar-forge.merchant-intake.v1', 'Expected original SF70 merchant-intake.v1 JSON');
  ensure(['REMEDIATION_REQUIRED','INCONCLUSIVE','UNPAID_DISCOVERY_AND_BROWSER_READY'].includes(intake.state), 'Unknown original SF70 state');
  ensure(utc(intake.observedAt), 'Missing original UTC observation timestamp');
  ensure(intake.originals && typeof intake.originals.sellerCatalog === 'object', 'Original SF52 seller evidence is required');
  const safeGuards = intake.safeguards || {};
  ensure(safeGuards.walletCalls === 0 && safeGuards.paidRequests === 0 && safeGuards.settlementConfirmed === false, 'Input is not an unpaid original SF70 diagnostic');
  const s = intake.scope || {};
  ensure(https(s.resource) && https(s.catalog) && https(s.buyerOrigin), 'Original seller, facilitator and buyer scope must be HTTPS');
  ensure(new URL(s.buyerOrigin).origin === s.buyerOrigin, 'Buyer origin must be an origin only');
  ensure(new URL(s.resource).origin !== s.buyerOrigin, 'Buyer and seller origins must differ');
  ensure(/^stellar:[a-z0-9-]{2,32}$/.test(s.network) && text(s.payTo) && text(s.payTo).length<=256, 'Invalid exact Stellar network or payTo');
  ensure(['GET','POST','PUT','PATCH','DELETE'].includes(s.intendedRetryMethod), 'Unknown intended buyer method');
  const modes=[s.browserCredentialed,intake.originals.browserReadiness?.credentialed].filter(x=>x!==undefined);
  ensure(modes.every(x=>typeof x==='boolean'), 'Invalid original browser credential mode');
  ensure(modes.every(x=>x===modes[0]), 'Original observations disagree about browser credential mode');
  // Compute through the original comparator; never accept an asserted comparison verdict.
  const repairReview = recheck === null ? null : compare({after:recheck.after,afterSha:recheck.afterSha,
    postBefore:recheck.postBefore,postAfter:recheck.postAfter,
    postBeforeSha:recheck.postBeforeSha,postAfterSha:recheck.postAfterSha,
    before:intake,beforeSha:inputHash});
  const browserCredentialed=repairReview ? repairReview.scope.browserCredentialed : modes[0]??null;
  ensure(Array.isArray(intake.findings) && intake.findings.length<=200, 'Original findings array is required');
  const findings = intake.findings.map((f, i) => {
    ensure(['HIGH','UNKNOWN'].includes(f?.severity) && /^[A-Z0-9_]{2,100}$/.test(f.code) && text(f.action).length<=2000, `Bad original finding #${i}`);
    return {severity:f.severity, code:f.code, originalAction:text(f.action)};
  });
  ensure(typeof terms==='object' && terms && !Array.isArray(terms), 'Operator terms object required');
  ensure(text(terms.workOrderRef) && text(terms.workOrderRef).length<=120, 'Work order reference required');
  ensure(text(terms.sellerDisplayName) && text(terms.sellerDisplayName).length<=200, 'Seller name required');
  ensure(text(terms.relationshipOwner) && text(terms.relationshipOwner).length<=200, 'Named owner required');
  ensure(['NOT_RECORDED','CONFIRMED'].includes(terms.merchantConsent?.status), 'Explicit merchant consent status required');
  if (terms.merchantConsent.status==='CONFIRMED') ensure(https(terms.merchantConsent.receiptUrl), 'Confirmed seller consent requires an HTTPS receipt URL');
  const c = terms.commercial || {};
  ensure(['NOT_APPROVED','OWNER_APPROVED_PROPOSAL'].includes(c.priceApproval), 'Explicit price approval state required');
  if (c.feeUsd !== null && c.feeUsd !== undefined) ensure(usd(c.feeUsd) && c.feeUsd > 0, 'Fee must be positive USD with <=2 decimal places');
  if (c.costUsd !== null && c.costUsd !== undefined) ensure(usd(c.costUsd), 'Cost must be nonnegative USD with <=2 decimal places');
  const proposedFee = c.feeUsd ?? null;
  const cost = c.costUsd ?? null;
  const priceApproved = c.priceApproval==='OWNER_APPROVED_PROPOSAL';
  if (priceApproved) ensure(proposedFee!==null && cost!==null && https(c.approvalReceiptUrl), 'Owner-approved price needs fee, cost and actual receipt');
  const margin = priceApproved ? (proposedFee-cost)/proposedFee : null;
  ensure(!priceApproved || margin >= 0, 'Approved proposal cannot be loss-making without owner revision');
  const contactAllowed = terms.merchantConsent.status==='CONFIRMED';
  const currentAssessment = intake.state==='REMEDIATION_REQUIRED' ? 'ORIGINAL_DEFECTS_RECORDED' : intake.state==='INCONCLUSIVE' ? 'INSUFFICIENT_ORIGINAL_COVERAGE' : 'UNPAID_DISCOVERY_ONLY_READY';
  const steps = [
    {key:'01-baseline',title:'Agree precise seller/buyer boundary',type:'SCOPE',acceptance:'Seller validates the resource, facilitator, buyer Origin, network, payTo, intended method and browser credential mode against the original saved report hash; records explicit consent for remediation.'},
    ...findings.map((f,i)=>({key:`02-finding-${String(i+1).padStart(2,'0')}`,title:`${f.code} (${f.severity})`,type:f.severity==='HIGH'?'REPAIR_CANDIDATE':'EVIDENCE_GAP',acceptance:`Resolve or explain the source-recorded condition: ${f.originalAction} Preserve independent operator evidence before claiming closure.`})),
    {key:'03-recheck',title:'Same-scope source recheck',type:'TECHNICAL_ACCEPTANCE',acceptance:`Review original SF70 reports for the IDENTICAL resource, catalog, buyer Origin, network, payTo, ${s.intendedRetryMethod} method and browser credential mode (${modeLabel(browserCredentialed)}); retain original files and hashes. ${repairReview ? `Original SF76 result: ${repairReview.classification}. Unpaid technical milestone observed: ${repairReview.technicalMilestoneObserved}. This observation leaves seller acceptance open.` : 'No after report supplied; capture and compare the same scope.'} Unknown credential mode cannot establish a same-scope milestone. For non-GET, inspect an authorized actual-method route; an unpaid GET or OPTIONS alone cannot prove POST checkout.`},
    {key:'04-handoff',title:'Seller signoff and commercial handover',type:'CUSTOMER_ACCEPTANCE',acceptance:'Record seller acknowledgement, evidence archive and agreed support boundary. Separately obtain payment/settlement provider receipts if a paid claim is made; this packet creates neither an invoice nor a transaction.'}
  ];
  return {
    schema:SCHEMA, generatedAt, workOrderRef: text(terms.workOrderRef),
    seller: {displayName:text(terms.sellerDisplayName), relationshipOwner:text(terms.relationshipOwner), consentStatus:terms.merchantConsent.status, consentReceipt:contactAllowed?terms.merchantConsent.receiptUrl:null},
    scope:{resource:s.resource,catalog:s.catalog,buyerOrigin:s.buyerOrigin,network:s.network,payTo:s.payTo,intendedRetryMethod:s.intendedRetryMethod,browserCredentialed},
    baseline:{schema:intake.schema, sourceSha256:inputHash, observedAt:intake.observedAt, originalState:intake.state, assessment:currentAssessment, findings, highCount:findings.filter(x=>x.severity==='HIGH').length, unknownCount:findings.filter(x=>x.severity==='UNKNOWN').length},
    repairReview,
    commercial:{priceApproval:c.priceApproval, approvedFeeUsd:priceApproved?proposedFee:null, approvedCostUsd:priceApproved?cost:null, ownerReceipt:priceApproved?c.approvalReceiptUrl:null, marginPercent:priceApproved?Number((margin*100).toFixed(2)):null, proposedWindow:text(terms.proposedWindow)||'UNSCHEDULED'},
    milestones:steps, readiness: contactAllowed && priceApproved ? 'READY_FOR_OWNER_TO_REVIEW_UNSENT_OFFER':'INTERNAL_UNSENT_PACKET',
    limits:{isSellerDiagnostic:true, livePaymentVerified:false, sellerHasAcceptedWork:false, invoiceIssued:false, cashReceived:false, newNetworkCalls:0, merchantConsentDoesNotAuthorizeAnyPaidAction:true}
  };
}

export function renderChecklist(p) {
  const lines=[
    `# ${p.workOrderRef} · Seller acceptance checklist`,
    '',`Seller: ${p.seller.displayName}; owner: ${p.seller.relationshipOwner}`,
    `Original SF70: ${p.baseline.originalState}, observed ${p.baseline.observedAt}`,
    `Exact input SHA-256: ${p.baseline.sourceSha256}`,
    `Scope: ${p.scope.intendedRetryMethod} ${p.scope.resource}`,
    `Facilitator: ${p.scope.catalog}`,
    `Buyer Origin: ${p.scope.buyerOrigin}; network: ${p.scope.network}; payTo: ${p.scope.payTo}`,
    `Browser credential mode: ${modeLabel(p.scope.browserCredentialed)}`,
    `Seller consent: ${p.seller.consentStatus}; fee: ${fmt(p.commercial.approvedFeeUsd)}; price approval: ${p.commercial.priceApproval}`,
    '', 'Every box below is OPEN. Any original SF76 comparison below is an unpaid technical observation; it does not certify merchant fixes, authorize outbound contact, record seller acceptance, or issue invoices.', ''
  ];
  if(p.repairReview) {
    const r=p.repairReview;
    lines.push('## Original before/after repair review','',`Result: ${r.classification}`,
      `Unpaid technical milestone observed: ${r.technicalMilestoneObserved}`,'');
    for(const side of ['before','after']) {const s=r.source[side];lines.push(`${side}: ${s.state}; ${s.observedAt}; SHA-256 ${s.sha256}; ${modeLabel(s.browserCredentialed)}; catalog complete: ${s.catalogComplete}`);}
    for(const key of ['sf72Before','sf72After']) {const s=r.source[key];if(s) lines.push(`${key}: ${s.status}; ${s.observedAt}; SHA-256 ${s.reportSha256}; OPTIONS requests: ${s.optionsRequests}`);}
    lines.push('',r.boundaries.note,'');
    for(const [key,label] of changeGroups) {lines.push(`### ${label}`,'',...(r.changes[key].length ? r.changes[key].map(f=>`- ${f.code} (${f.severity}): ${f.action}`) : ['None recorded.']),'');}
  } else lines.push('Recheck: NOT SUPPLIED. The original baseline remains the only observation.','');
  for(const m of p.milestones){lines.push(`- [ ] **${m.key}: ${m.title}** [${m.type}]`,`  - Acceptance: ${m.acceptance}`,'  - Operator evidence URL/file digest: ______','  - Seller reviewer/date: ______','');}
  lines.push('## Seller decision','', '- [ ] Accept completed scope (approval receipt: ______)', '- [ ] Request changes (list: ______)', '- [ ] Approve a separately issued commercial contract or quote (reference: ______)', '- [ ] Confirm invoice/payment *only from independent provider evidence* (reference: ______)', '', 'Generated packet is an INTERNAL/UNSENT engineering workshare draft, not evidence of a contract, paid pilot or grant award.');
  return lines.join('\n')+'\n';
}

function renderRepairHtml(r) {
  if(!r) return '<h2>Repair review</h2><p class="warning">No after report supplied. The original baseline remains the only observation.</p>';
  const sources=['before','after'].map(side=>{const s=r.source[side];return `<div class="card"><small>${esc(side)} · ${esc(s.observedAt)}</small><strong>${esc(s.state)}</strong><p>${esc(modeLabel(s.browserCredentialed))}<br>Catalog complete: ${s.catalogComplete}</p><p class="digest">${esc(s.sha256)}</p></div>`;}).join('');
  const post=['sf72Before','sf72After'].filter(key=>r.source[key]).map(key=>{const s=r.source[key];return `<p><strong>${esc(key)}:</strong> ${esc(s.status)} · ${esc(s.observedAt)} · ${s.optionsRequests} OPTIONS request(s)<br><span class="digest">${esc(s.reportSha256)}</span></p>`;}).join('');
  const changes=changeGroups.map(([key,label])=>`<section class="step"><h3>${esc(label)}</h3>${r.changes[key].length ? '<ul>'+r.changes[key].map(f=>`<li><strong>${esc(f.code)}</strong> (${esc(f.severity)})<p>${esc(f.action)}</p></li>`).join('')+'</ul>' : '<p class="muted">None recorded.</p>'}</section>`).join('');
  return `<h2>Original before/after repair review</h2><div class="scope"><strong>${esc(r.classification)}</strong><p>Unpaid technical milestone observed: <strong>${r.technicalMilestoneObserved}</strong>. Seller acceptance remains open.</p><p class="warning">${esc(r.boundaries.note)}</p><div class="cards">${sources}</div>${post}</div>${changes}`;
}

export function renderHtml(p) {
  const findings = p.baseline.findings.map(f=>`<li><strong>${esc(f.code)}</strong> <span class="${f.severity==='HIGH'?'high':'unknown'}">${esc(f.severity)}</span><p>${esc(f.originalAction)}</p></li>`).join('') || '<li>No SF70 findings at this unpaid observation. This is not evidence of a completed paid checkout.</li>';
  const milestones=p.milestones.map(m=>`<section class="step"><span class="kind">${esc(m.type)}</span><h3>${esc(m.title)}</h3><p>${esc(m.acceptance)}</p><p class="proof">Evidence: ____________________ &nbsp; Seller review: ____________________</p></section>`).join('');
  const link = (u,label)=>`<a href="${esc(u)}" rel="noopener noreferrer">${esc(label)}</a>`;
  const repairHtml=renderRepairHtml(p.repairReview);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.workOrderRef)} · Merchant pilot</title><style>:root{font-family:system-ui,-apple-system,sans-serif;color:#172234;background:#f5f7fb}body{max-width:1050px;margin:0 auto;padding:30px 20px}header{background:#142d4d;color:white;border-radius:18px;padding:30px}h1{margin:10px 0;font-size:clamp(1.6rem,3vw,2.5rem)}h2{margin-top:33px}p,li{line-height:1.55}header p{color:#daebff}.pill,.kind{display:inline-block;font-size:.78rem;font-weight:700;letter-spacing:.04em;padding:6px 10px;border-radius:9px;background:#e4edf7;color:#26496d}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.card,.step{background:white;border-radius:13px;padding:20px;border:1px solid #e1e7ef}.card small{display:block;color:#607084;margin-bottom:8px}.card strong{overflow-wrap:anywhere}.high{color:#922e28;font-weight:700}.unknown{color:#826126;font-weight:700}.scope{background:white;padding:20px;border-radius:13px;overflow-wrap:anywhere}.scope dt{font-weight:700;margin-top:12px}.scope dd{margin:4px 0 6px}.step{margin:12px 0}.proof{border-top:1px solid #e2e7ef;padding-top:10px;color:#53647a}.warning{border-left:4px solid #bd7d39;background:#fff9ed;padding:15px}.muted{color:#5f7084}.digest{font-family:ui-monospace,monospace;font-size:.83rem;overflow-wrap:anywhere}a{color:#005aa0}footer{margin:30px 0;color:#56677b}</style><header><span class="pill">Internal · seller-approved workflow only</span><h1>${esc(p.seller.displayName)} · Merchant pilot</h1><p>${esc(p.workOrderRef)} · owner ${esc(p.seller.relationshipOwner)} · ${esc(p.readiness)}</p></header><div class="cards" style="margin-top:18px"><div class="card"><small>Original SF70 observation</small><strong>${esc(p.baseline.originalState)}</strong></div><div class="card"><small>Remediation candidates / unknowns</small><strong>${p.baseline.highCount} / ${p.baseline.unknownCount}</strong></div><div class="card"><small>Seller consent</small><strong>${esc(p.seller.consentStatus)}</strong></div><div class="card"><small>Approved pilot fee</small><strong>${esc(fmt(p.commercial.approvedFeeUsd))}</strong></div></div><h2>Exact technical scope</h2><dl class="scope"><dt>Seller</dt><dd>${link(p.scope.resource,p.scope.resource)}</dd><dt>Facilitator discovery</dt><dd>${link(p.scope.catalog,p.scope.catalog)}</dd><dt>Actual intended buyer operation</dt><dd>${esc(p.scope.intendedRetryMethod)} from ${esc(p.scope.buyerOrigin)}</dd><dt>Browser credential mode</dt><dd>${esc(modeLabel(p.scope.browserCredentialed))}</dd><dt>Stellar payment pair</dt><dd>${esc(p.scope.network)} · ${esc(p.scope.payTo)}</dd><dt>Original report timestamp / SHA-256</dt><dd>${esc(p.baseline.observedAt)} · <span class="digest">${esc(p.baseline.sourceSha256)}</span></dd></dl><h2>Source-recorded observations</h2><ul class="scope">${findings}</ul>${repairHtml}<h2>Workshare delivery and acceptance</h2>${milestones}<h2>Commercial handoff</h2><p class="warning">Price state: ${esc(p.commercial.priceApproval)}. Approved fee: ${esc(fmt(p.commercial.approvedFeeUsd))}. Proposed window: ${esc(p.commercial.proposedWindow)}. This document is UNSENT and requires seller/owner review. No live transaction or payment has been verified.</p><p class="muted">The underlying SF70 diagnostic makes unpaid, method-aware discovery and browser readiness observations only. A healthy unpaid response is NOT a settlement or merchant acceptance. The original source JSON is intentionally not modified by this exporter.</p><footer>SCF SF77 · Local evidence-bound engineering-to-commercial work order · ${esc(p.generatedAt)}</footer></html>`;
}

export function parseArgs(argv) {
  if(argv.length===1 && argv[0]==='--help') return {help:true};
  const v={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i], val=argv[i+1];
    ensure(['--intake','--terms','--out','--at','--after','--sf72-before','--sf72-after'].includes(k) && val && !val.startsWith('--') && !Object.hasOwn(v,k), 'Usage: --intake ORIGINAL_SF70.json --terms OWNER_TERMS.json --out NEW_DIRECTORY [--after AFTER_SF70.json] [--sf72-before BEFORE_SF72.json --sf72-after AFTER_SF72.json] [--at ISO]');
    v[k]=val;
  }
  for(const k of ['--intake','--terms','--out']) ensure(v[k],`Required ${k}`);
  ensure(Boolean(v['--sf72-before'])===Boolean(v['--sf72-after']), 'Provide both original SF72 reports or neither');
  ensure(!v['--sf72-before'] || v['--after'], 'SF72 comparison requires --after');
  return {intake:v['--intake'],terms:v['--terms'],out:v['--out'],after:v['--after'],
    postBefore:v['--sf72-before'],postAfter:v['--sf72-after'],at:v['--at']??new Date().toISOString()};
}

export async function main(argv=process.argv.slice(2)) {
  const opts=parseArgs(argv);
  if(opts.help){console.log('node workorder.mjs --intake ORIGINAL_SF70.json --terms OWNER_TERMS.json --out NEW_DIRECTORY [--after AFTER_SF70.json] [--sf72-before BEFORE_SF72.json --sf72-after AFTER_SF72.json] [--at 2026-10-11T12:00:00Z]');return;}
  ensure(utc(opts.at),'--at must be a valid UTC timestamp');
  const [a,b,after,pb,pa]=await Promise.all([smallJson(opts.intake,opts.after?2_000_000:undefined),smallJson(opts.terms),
    opts.after?smallJson(opts.after,2_000_000):null,opts.postBefore?smallJson(opts.postBefore,2_000_000):null,
    opts.postAfter?smallJson(opts.postAfter,2_000_000):null]);
  const packet=buildPacket(a.doc,b.doc,digest(a.raw),opts.at,after?{after:after.doc,afterSha:digest(after.raw),
    postBefore:pb?.doc,postAfter:pa?.doc,postBeforeSha:pb?digest(pb.raw):undefined,postAfterSha:pa?digest(pa.raw):undefined}:null);
  await mkdir(opts.out,{mode:0o700}); // Never replace a prior acceptance packet.
  const output=[['packet.json',JSON.stringify(packet,null,2)+'\n'],['seller-packet.html',renderHtml(packet)],['acceptance-checklist.md',renderChecklist(packet)]];
  for(const [name,body] of output) await writeFile(path.join(opts.out,name),body,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({schema:SCHEMA,outputDir:path.resolve(opts.out),files:output.map(x=>x[0]),sourceSha256:packet.baseline.sourceSha256,readiness:packet.readiness,findings:packet.baseline.findings.length,repairClassification:packet.repairReview?.classification??null,approvedFeeUsd:packet.commercial.approvedFeeUsd},null,2));
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) main().catch(e=>{console.error('SF77: '+e.message);process.exitCode=1;});

