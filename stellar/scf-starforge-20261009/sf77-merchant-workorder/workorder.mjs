#!/usr/bin/env node
// MIT. Original merchant workorders from retained diagnosis or runtime case sources.
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare} from '../sf76-merchant-remediation-delta/compare.mjs';
import {supportsSellerMethod} from '../sf30-seller-sdk/http-methods.mjs';
import {reviewRuntime, importRuntimeHandoff, MAX_HANDOFF_BYTES} from '../sf74-merchant-support-console/runtime-support.mjs';
import {parseWorkspace} from '../sf74-merchant-support-console/workspace-file.mjs';

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

function deliveryTerms(value) {
  if(value===undefined)return null;
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>['scope','deliverables','acceptanceCriteria'].includes(key)), 'Invalid owner delivery terms');
  const result={};
  for(const key of ['scope','deliverables','acceptanceCriteria']) {
    ensure(value[key]===undefined||typeof value[key]==='string'&&value[key].length<=8192,
      'Owner '+key+' must be text of at most 8192 characters');
    result[key]=text(value[key]);
  }
  return Object.values(result).some(Boolean)?result:null;
}

// Both original source paths use the same terms, economics and packet assembler.
function finishPacket({generatedAt,scope,baseline,repairReview=null,runtimeReview=null,milestones},terms) {
  ensure(utc(generatedAt), 'Workorder generation time must be UTC');
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
  const proposedFee = c.feeUsd ?? null, cost = c.costUsd ?? null;
  const priceApproved = c.priceApproval==='OWNER_APPROVED_PROPOSAL';
  if (priceApproved) ensure(proposedFee!==null && cost!==null && https(c.approvalReceiptUrl), 'Owner-approved price needs fee, cost and actual receipt');
  const margin = priceApproved ? (proposedFee-cost)/proposedFee : null;
  ensure(!priceApproved || margin >= 0, 'Approved proposal cannot be loss-making without owner revision');
  const contactAllowed = terms.merchantConsent.status==='CONFIRMED', delivery=deliveryTerms(terms.delivery);
  const steps=delivery?[...milestones.slice(0,-1),{key:'owner-delivery',title:'Owner-entered delivery and acceptance',
    type:'OWNER_SCOPE_REVIEW',acceptance:[delivery.scope&&'Scope: '+delivery.scope,
      delivery.deliverables&&'Deliverables: '+delivery.deliverables,
      delivery.acceptanceCriteria&&'Acceptance criteria: '+delivery.acceptanceCriteria].filter(Boolean).join('\n')},milestones.at(-1)]:milestones;
  return {
    schema:SCHEMA, generatedAt, workOrderRef:text(terms.workOrderRef),
    seller:{displayName:text(terms.sellerDisplayName),relationshipOwner:text(terms.relationshipOwner),
      consentStatus:terms.merchantConsent.status,consentReceipt:contactAllowed?terms.merchantConsent.receiptUrl:null},
    scope,baseline,repairReview,...(runtimeReview?{sourceKind:'RUNTIME',runtimeReview}:{}),
    commercial:{priceApproval:c.priceApproval,approvedFeeUsd:priceApproved?proposedFee:null,approvedCostUsd:priceApproved?cost:null,
      ownerReceipt:priceApproved?c.approvalReceiptUrl:null,marginPercent:priceApproved?Number((margin*100).toFixed(2)):null,
      proposedWindow:text(terms.proposedWindow)||'UNSCHEDULED'},
    ...(delivery?{delivery}:{}),milestones:steps,
    readiness:contactAllowed&&priceApproved?'READY_FOR_OWNER_TO_REVIEW_UNSENT_OFFER':'INTERNAL_UNSENT_PACKET',
    limits:{isSellerDiagnostic:!runtimeReview,...(runtimeReview?{isRetainedRuntimeReview:true}:{}),livePaymentVerified:false,
      sellerHasAcceptedWork:false,invoiceIssued:false,cashReceived:false,newNetworkCalls:0,merchantConsentDoesNotAuthorizeAnyPaidAction:true}
  };
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
  ensure(supportsSellerMethod(s.intendedRetryMethod), 'Unknown intended buyer method');
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
  const currentAssessment = intake.state==='REMEDIATION_REQUIRED' ? 'ORIGINAL_DEFECTS_RECORDED' : intake.state==='INCONCLUSIVE' ? 'INSUFFICIENT_ORIGINAL_COVERAGE' : 'UNPAID_DISCOVERY_ONLY_READY';
  const steps = [
    {key:'01-baseline',title:'Agree precise seller/buyer boundary',type:'SCOPE',acceptance:'Seller validates the resource, facilitator, buyer Origin, network, payTo, intended method and browser credential mode against the original saved report hash; records explicit consent for remediation.'},
    ...findings.map((f,i)=>({key:`02-finding-${String(i+1).padStart(2,'0')}`,title:`${f.code} (${f.severity})`,type:f.severity==='HIGH'?'REPAIR_CANDIDATE':'EVIDENCE_GAP',acceptance:`Resolve or explain the source-recorded condition: ${f.originalAction} Preserve independent operator evidence before claiming closure.`})),
    {key:'03-recheck',title:'Same-scope source recheck',type:'TECHNICAL_ACCEPTANCE',acceptance:`Review original SF70 reports for the IDENTICAL resource, catalog, buyer Origin, network, payTo, ${s.intendedRetryMethod} method and browser credential mode (${modeLabel(browserCredentialed)}); retain original files and hashes. ${repairReview ? `Original SF76 result: ${repairReview.classification}. Unpaid technical milestone observed: ${repairReview.technicalMilestoneObserved}. This observation leaves seller acceptance open.` : 'No after report supplied; capture and compare the same scope.'} Unknown credential mode cannot establish a same-scope milestone. For non-GET, inspect an authorized actual-method route; an unpaid GET or OPTIONS alone cannot prove POST checkout.`},
    {key:'04-handoff',title:'Seller signoff and commercial handover',type:'CUSTOMER_ACCEPTANCE',acceptance:'Record seller acknowledgement, evidence archive and agreed support boundary. Separately obtain payment/settlement provider receipts if a paid claim is made; this packet creates neither an invoice nor a transaction.'}
  ];
  return finishPacket({generatedAt,
    scope:{resource:s.resource,catalog:s.catalog,buyerOrigin:s.buyerOrigin,network:s.network,payTo:s.payTo,intendedRetryMethod:s.intendedRetryMethod,browserCredentialed},
    baseline:{schema:intake.schema, sourceSha256:inputHash, observedAt:intake.observedAt, originalState:intake.state, assessment:currentAssessment, findings, highCount:findings.filter(x=>x.severity==='HIGH').length, unknownCount:findings.filter(x=>x.severity==='UNKNOWN').length},
    repairReview,milestones:steps},terms);
}

/** Build the same workorder from original SF74 sources; never invent an SF70 report. */
export function buildRuntimePacket({supportText,inputs},terms,generatedAt=new Date().toISOString()) {
  const runtimeReview=reviewRuntime(supportText,inputs),latest=runtimeReview.after??runtimeReview.before;
  ensure(latest.caseMatches, 'Use the latest runtime capture\'s saved case mapping or attach a source for the current mapping');
  const s=latest.scope.inputs;
  // Runtime records need no unrelated discovery/CORS assessment. Optional saved
  // scope fields stay unfilled; actual route and payment-option identities remain in the review.
  for(const key of ['resource','catalog','origin'])if(s[key]) {
    const url=new URL(s[key]);
    ensure(['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password,
      'Invalid saved runtime '+key+' URL');
    if(key==='origin')ensure(url.origin===s.origin, 'The recorded buyer origin must be an origin only');
  }
  ensure(supportsSellerMethod(s.method)&&(!s.network||/^stellar:[a-z0-9-]{2,32}$/.test(s.network))&&s.payTo.length<=256,
    'Invalid recorded runtime method, Stellar network or public payment recipient');
  const findings=runtimeReview.queue.map((finding,index)=>({
    severity:['http','native'].includes(finding.kind)?'OBSERVED':'CONTEXT',code:'RUNTIME_'+finding.kind.toUpperCase(),
    originalAction:finding.action,source:finding.source,routeId:finding.routeId,eventId:finding.eventId??null,
    reference:'runtime-'+String(index+1).padStart(3,'0')}));
  const milestones=[
    {key:'01-runtime-scope',title:'Agree the retained merchant operation and scope',type:'SCOPE',
      acceptance:'Review the saved merchant mapping, exact observed method/path, original source file hashes, selected UTC periods or process sessions, and current payment-option identities. Confirm which observed conditions and owner-entered deliverables belong in this work.'},
    ...findings.map(f=>({key:f.reference,title:f.code+' · '+f.source,
      type:f.severity==='OBSERVED'?'OBSERVED_CONDITION_REVIEW':'COVERAGE_OR_SCOPE_REVIEW',
      acceptance:f.originalAction+(f.eventId?' Original event: '+f.eventId+'.':'')+' Record the resulting action and its source. The observation is not a customer acceptance.'})),
    {key:'03-runtime-follow-up',title:'Review the actual operational follow-up',type:'TECHNICAL_ACCEPTANCE',
      acceptance:runtimeReview.comparison.detail+' Preserve the same route/option identities in any follow-up. Traffic, native settlement notices, inbox delivery and customer fulfillment retain their separate meanings.'},
    {key:'04-handoff',title:'Merchant review and commercial handover',type:'CUSTOMER_ACCEPTANCE',
      acceptance:'Review the agreed deliverables and acceptance criteria with the merchant, retain the complete source case and record its decision. Record commercial agreement, invoicing and receipt of funds through their actual existing systems.'}
  ];
  return finishPacket({generatedAt,
    scope:{resource:s.resource,catalog:s.catalog,buyerOrigin:s.origin,network:s.network,payTo:s.payTo,
      intendedRetryMethod:s.method,browserCredentialed:s.credentialed,routeId:latest.scope.routeId,observedPath:latest.route.path??null},
    baseline:{schema:'stellar-forge.merchant-runtime-case.v1',sourceSha256:digest(supportText),
      observedAt:latest.capturedAt,originalState:runtimeReview.comparison.state,assessment:'ORIGINAL_RUNTIME_REVIEW',findings,
      observedCount:findings.filter(f=>f.severity==='OBSERVED').length,contextCount:findings.filter(f=>f.severity==='CONTEXT').length},
    runtimeReview,milestones},terms);
}

export function renderChecklist(p) {
  const runtime=p.runtimeReview;
  const lines=[
    `# ${p.workOrderRef} · Seller acceptance checklist`,
    '',`Seller: ${p.seller.displayName}; owner: ${p.seller.relationshipOwner}`,
    `${runtime?'Original runtime case':'Original SF70'}: ${p.baseline.originalState}, observed ${p.baseline.observedAt}`,
    `Exact input SHA-256: ${p.baseline.sourceSha256}`,
    `Scope: ${p.scope.intendedRetryMethod} ${p.scope.resource||'Resource not recorded'}`,
    `Facilitator: ${p.scope.catalog||'Not recorded'}`,
    `Buyer Origin: ${p.scope.buyerOrigin||'Not recorded'}; network: ${p.scope.network||'Not recorded'}; payTo: ${p.scope.payTo||'Not recorded'}`,
    `Browser credential mode: ${modeLabel(p.scope.browserCredentialed)}`,
    `Seller consent: ${p.seller.consentStatus}; fee: ${fmt(p.commercial.approvedFeeUsd)}; price approval: ${p.commercial.priceApproval}`,
    '',runtime?'Acceptance boxes are open. The original runtime review records observed operations and source coverage; the merchant records its agreement and acceptance separately.':
      'Every box below is OPEN. Any original SF76 comparison below is an unpaid technical observation; it does not certify merchant fixes, authorize outbound contact, record seller acceptance, or issue invoices.', ''
  ];
  if(runtime) {
    lines.push('## Original runtime review','',runtime.comparison.detail,'');
    for(const side of ['before','after']) {
      const c=runtime[side];if(!c)continue;
      lines.push(`### ${side}: ${c.scope.routeId} · ${c.route.method}${c.route.path?' '+c.route.path:''}`,'',
        `Saved mapping: ${c.scope.inputs.resource}; ${c.caseMatches?'matches current case':'earlier mapping'}`,
        `Observed: ${c.startedAt} → ${c.capturedAt}; mode ${c.mode}`,
        c.period?`Selected UTC dates: ${c.period.range.from} → ${c.period.range.to}; ${c.sessionIds.length} original sessions`:`Original session: ${c.sessionId}`,
        `Recorded outcomes: ${c.route.started} starts; ${c.route.completed} completed; ${c.route.success} 2xx; ${c.route.challenge} 402; ${c.route.serverError} 5xx; ${c.route.disconnected} disconnected.`,'');
      for(const file of c.files)lines.push(`- ${file.name}: ${file.bytes} bytes; SHA-256 ${file.sha256}`);
      for(const option of runtimeOptions(c))lines.push(`- Current option ${option.optionIndex}: ${option.network}; asset SHA-256 ${option.assetDigest}; ${option.amountAtomic} atomic; recipient SHA-256 ${option.recipientDigest}; timeout ${option.maxTimeoutSeconds??'unknown'}s.`);
      lines.push('');
    }
    lines.push('Full original review, coverage and native event decisions are in packet.json. Original source bytes remain in the complete merchant-support handoff.','');
  } else if(p.repairReview) {
    const r=p.repairReview;
    lines.push('## Original before/after repair review','',`Result: ${r.classification}`,
      `Unpaid technical milestone observed: ${r.technicalMilestoneObserved}`,'');
    for(const side of ['before','after']) {const s=r.source[side];lines.push(`${side}: ${s.state}; ${s.observedAt}; SHA-256 ${s.sha256}; ${modeLabel(s.browserCredentialed)}; catalog complete: ${s.catalogComplete}`);}
    for(const key of ['sf72Before','sf72After']) {const s=r.source[key];if(s) lines.push(`${key}: ${s.status}; ${s.observedAt}; SHA-256 ${s.reportSha256}; OPTIONS requests: ${s.optionsRequests}`);}
    lines.push('',r.boundaries.note,'');
    for(const [key,label] of changeGroups) {lines.push(`### ${label}`,'',...(r.changes[key].length ? r.changes[key].map(f=>`- ${f.code} (${f.severity}): ${f.action}`) : ['None recorded.']),'');}
  } else lines.push('Recheck: NOT SUPPLIED. The original baseline remains the only observation.','');
  if(p.delivery)lines.push('## Owner-entered delivery terms','',`Scope: ${p.delivery.scope||'Not entered'}`,'',
    `Deliverables: ${p.delivery.deliverables||'Not entered'}`,'',`Acceptance criteria: ${p.delivery.acceptanceCriteria||'Not entered'}`,'');
  for(const m of p.milestones){lines.push(`- [ ] **${m.key}: ${m.title}** [${m.type}]`,`  - Acceptance: ${m.acceptance}`,'  - Operator evidence URL/file digest: ______','  - Seller reviewer/date: ______','');}
  lines.push('## Seller decision','', '- [ ] Accept completed scope (approval receipt: ______)', '- [ ] Request changes (list: ______)', '- [ ] Approve a separately issued commercial contract or quote (reference: ______)', '- [ ] Confirm invoice/payment *only from independent provider evidence* (reference: ______)', '', 'Generated packet is an INTERNAL/UNSENT engineering workshare draft, not evidence of a contract, paid pilot or grant award.');
  return lines.join('\n')+'\n';
}

const runtimeOptions=c=>(c.native?.options??c.period?.paymentOptions??[])
  .filter(option=>option.routeId===c.scope.routeId&&option.method===c.route.method);
const tableHtml=(headers,rows)=>'<div class="scroll"><table><thead><tr>'+headers.map(value=>'<th>'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function renderRuntimeHtml(review) {
  let html='<h2>Original runtime review</h2><p>'+esc(review.comparison.detail)+'</p>';
  for(const side of ['before','after']) {
    const c=review[side];if(!c)continue;
    html+='<section class="step"><h3>'+esc(side)+' · '+esc(c.scope.routeId)+' · '+esc(c.route.method)+' '+esc(c.route.path??'')+'</h3>'+
      '<p>'+esc(c.scope.inputs.resource)+' · '+(c.caseMatches?'Current saved mapping':'Earlier saved mapping')+'</p>'+
      '<p>'+esc(c.startedAt)+' → '+esc(c.capturedAt)+' · '+esc(c.mode)+' · '+
        (c.period?esc(c.sessionIds.length)+' original sessions':'Session '+esc(c.sessionId))+'</p>'+
      (c.period?'<p>Selected UTC dates '+esc(c.period.range.from)+' → '+esc(c.period.range.to)+
        '. '+(c.route.hasSavedCoverage?'Selected method/path has retained observations.':'No observations were retained for the selected method/path.')+
        ' Session gaps and historical path variants remain in the original review.</p>':'')+
      tableHtml(['Starts','Completed','2xx','402','5xx','Disconnected'],[[c.route.started,c.route.completed,c.route.success,c.route.challenge,c.route.serverError,c.route.disconnected]])+
      tableHtml(['Original source','Bytes','SHA-256'],c.files.map(file=>[file.name,file.bytes,file.sha256]));
    const options=runtimeOptions(c);
    if(options.length)html+='<h4>Current saved report payment options</h4><p>HTTP counts stay on their observed route. These identities are current reference terms when the selected path is historical.</p>'+
      tableHtml(['Option / network','Atomic amount / timeout','Asset SHA-256','Recipient SHA-256','Extra'],options.map(option=>[
        option.optionIndex+' / '+option.network,option.amountAtomic+' / '+(option.maxTimeoutSeconds??'unknown')+'s',
        option.assetDigest,option.recipientDigest,option.hasExtra?'In original report':'None']));
    html+='<p>Original alerts: '+esc(c.alerts.length?c.alerts.join(' '):'None recorded.')+'</p></section>';
  }
  return html+'<p>The workorder JSON retains the original detailed comparison, saved coverage, native event decisions and exclusions. The complete merchant-support handoff retains the source bytes.</p>';
}

function renderRepairHtml(r) {
  if(!r) return '<h2>Repair review</h2><p class="warning">No after report supplied. The original baseline remains the only observation.</p>';
  const sources=['before','after'].map(side=>{const s=r.source[side];return `<div class="card"><small>${esc(side)} · ${esc(s.observedAt)}</small><strong>${esc(s.state)}</strong><p>${esc(modeLabel(s.browserCredentialed))}<br>Catalog complete: ${s.catalogComplete}</p><p class="digest">${esc(s.sha256)}</p></div>`;}).join('');
  const post=['sf72Before','sf72After'].filter(key=>r.source[key]).map(key=>{const s=r.source[key];return `<p><strong>${esc(key)}:</strong> ${esc(s.status)} · ${esc(s.observedAt)} · ${s.optionsRequests} OPTIONS request(s)<br><span class="digest">${esc(s.reportSha256)}</span></p>`;}).join('');
  const changes=changeGroups.map(([key,label])=>`<section class="step"><h3>${esc(label)}</h3>${r.changes[key].length ? '<ul>'+r.changes[key].map(f=>`<li><strong>${esc(f.code)}</strong> (${esc(f.severity)})<p>${esc(f.action)}</p></li>`).join('')+'</ul>' : '<p class="muted">None recorded.</p>'}</section>`).join('');
  return `<h2>Original before/after repair review</h2><div class="scope"><strong>${esc(r.classification)}</strong><p>Unpaid technical milestone observed: <strong>${r.technicalMilestoneObserved}</strong>. Seller acceptance remains open.</p><p class="warning">${esc(r.boundaries.note)}</p><div class="cards">${sources}</div>${post}</div>${changes}`;
}

export function renderHtml(p) {
  const runtime=p.runtimeReview;
  const findings=p.baseline.findings.length?p.baseline.findings.map(f=>`<li><strong>${esc(f.code)}</strong> · ${esc(f.severity)}${f.source?' · '+esc(f.source):''}<p>${esc(f.originalAction)}</p>${f.eventId?'<p class="digest">Original event '+esc(f.eventId)+'</p>':''}</li>`).join(''):
    '<li>No condition was recorded for a proposed repair. Define any intended service in the owner-entered scope.</li>';
  const milestones=p.milestones.map(m=>`<section class="step"><h3>${esc(m.key)} · ${esc(m.title)}</h3><p class="prewrap">${esc(m.acceptance)}</p><p class="muted">Merchant reviewer / decision / source reference: ____________________</p></section>`).join('');
  const delivery=p.delivery?`<h2>Owner-entered scope and acceptance</h2><section class="scope"><h3>Scope</h3><p class="prewrap">${esc(p.delivery.scope||'Not entered')}</p><h3>Deliverables</h3><p class="prewrap">${esc(p.delivery.deliverables||'Not entered')}</p><h3>Acceptance criteria</h3><p class="prewrap">${esc(p.delivery.acceptanceCriteria||'Not entered')}</p></section>`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(p.seller.displayName)} · Merchant workorder</title>
<style>body{font:15px/1.6 system-ui,sans-serif;color:#222;background:#f4f4f4;max-width:1100px;margin:auto;padding:32px 20px}header{border-bottom:2px solid #444;padding-bottom:18px}h1{font-size:27px}h2{font-size:20px;margin-top:30px}h3{font-size:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.card,.scope,.step{background:#fff;border:1px solid #ccc;padding:16px;margin:12px 0}.card strong{display:block;overflow-wrap:anywhere}small,.muted{color:#555}dt{font-weight:600}dd{margin:0 0 12px;overflow-wrap:anywhere}li,p,td{overflow-wrap:anywhere}.digest{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.prewrap{white-space:pre-wrap}.scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;vertical-align:top}a{color:#333}.warning{border-left:3px solid #777;padding:12px;background:#eee}footer{margin-top:30px;color:#555}@media(max-width:620px){body{padding:16px 10px}.scope,.step{padding:12px}th,td{font-size:11px;padding:5px}}@media print{body{background:#fff}.step{break-inside:avoid}}</style></head><body>
<header><small>Merchant operations · Draft workorder</small><h1>${esc(p.seller.displayName)} · Merchant workorder</h1><p>${esc(p.workOrderRef)} · Relationship owner ${esc(p.seller.relationshipOwner)}</p></header>
<div class="cards"><div class="card"><small>${runtime?'Original runtime case':'Original SF70 observation'}</small><strong>${runtime?'Retained operational sources':esc(p.baseline.originalState)}</strong></div><div class="card"><small>${runtime?'Observed conditions / context':'Remediation candidates / unknowns'}</small><strong>${runtime?p.baseline.observedCount+' / '+p.baseline.contextCount:p.baseline.highCount+' / '+p.baseline.unknownCount}</strong></div><div class="card"><small>Seller permission record</small><strong>${p.seller.consentStatus==='CONFIRMED'?'Recorded':'Not recorded'}</strong></div><div class="card"><small>Approved proposal fee</small><strong>${esc(fmt(p.commercial.approvedFeeUsd))}</strong></div></div>
<h2>Technical scope</h2><dl class="scope"><dt>Saved merchant resource</dt><dd>${esc(p.scope.resource||'Not recorded')}</dd><dt>Facilitator discovery</dt><dd>${esc(p.scope.catalog||'Not recorded')}</dd><dt>Intended buyer operation</dt><dd>${esc(p.scope.intendedRetryMethod)} from ${esc(p.scope.buyerOrigin||'Origin not recorded')}</dd><dt>Browser credential mode</dt><dd>${esc(modeLabel(p.scope.browserCredentialed))}</dd><dt>Saved Stellar payment mapping</dt><dd>${esc(p.scope.network||'Network not recorded')} · ${esc(p.scope.payTo||'Recipient not recorded')}</dd>${runtime?'<dt>Observed route</dt><dd>'+esc(p.scope.routeId)+' · '+esc(p.scope.observedPath??'Original process packet route')+'</dd>':''}<dt>Original source timestamp / SHA-256</dt><dd>${esc(p.baseline.observedAt)} · <span class="digest">${esc(p.baseline.sourceSha256)}</span></dd></dl>
${delivery}<h2>Source-recorded observations</h2><ul class="scope">${findings}</ul>${runtime?renderRuntimeHtml(runtime):renderRepairHtml(p.repairReview)}
<h2>Delivery and acceptance</h2>${milestones}<h2>Commercial handoff</h2><p class="warning">Approved proposal fee: ${esc(fmt(p.commercial.approvedFeeUsd))}. Proposed delivery window: ${esc(p.commercial.proposedWindow)}. Merchant agreement, acceptance and payment are recorded separately.</p>
<p class="muted">${runtime?'This workorder uses the original saved runtime review. HTTP responses, native notices, merchant inbox delivery and customer fulfillment keep their original meanings.':'The original SF70 observations cover unpaid discovery and browser readiness. They do not record a settled payment or merchant acceptance.'} Original source JSON remains unchanged.</p><footer>SF77 merchant workorder · ${esc(p.generatedAt)}</footer></body></html>`;
}

export function parseArgs(argv) {
  if(argv.length===1 && argv[0]==='--help') return {help:true};
  const v={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i], val=argv[i+1];
    ensure(['--intake','--handoff','--terms','--out','--at','--after','--sf72-before','--sf72-after'].includes(k) && val && !val.startsWith('--') && !Object.hasOwn(v,k), 'Usage: --intake ORIGINAL_SF70.json or --handoff CASE.merchant-support.json, with --terms OWNER_TERMS.json --out NEW_DIRECTORY');
    v[k]=val;
  }
  for(const k of ['--terms','--out']) ensure(v[k],`Required ${k}`);
  ensure(Boolean(v['--intake'])!==Boolean(v['--handoff']), 'Choose one original --intake or complete --handoff');
  ensure(!v['--handoff']||!['--after','--sf72-before','--sf72-after'].some(k=>v[k]), 'A runtime handoff retains its own before/follow-up sources');
  ensure(Boolean(v['--sf72-before'])===Boolean(v['--sf72-after']), 'Provide both original SF72 reports or neither');
  ensure(!v['--sf72-before'] || v['--after'], 'SF72 comparison requires --after');
  return {intake:v['--intake'],...(v['--handoff']?{handoff:v['--handoff']}:{}),terms:v['--terms'],out:v['--out'],after:v['--after'],
    postBefore:v['--sf72-before'],postAfter:v['--sf72-after'],at:v['--at']??new Date().toISOString()};
}

export async function main(argv=process.argv.slice(2)) {
  const opts=parseArgs(argv);
  if(opts.help){console.log('node workorder.mjs --intake ORIGINAL_SF70.json --terms OWNER_TERMS.json --out NEW_DIRECTORY [--after AFTER_SF70.json] [--sf72-before BEFORE_SF72.json --sf72-after AFTER_SF72.json] [--at UTC_ISO]\nnode workorder.mjs --handoff CASE.merchant-support.json --terms OWNER_TERMS.json --out NEW_DIRECTORY [--at UTC_ISO]');return;}
  ensure(utc(opts.at),'--at must be a valid UTC timestamp');
  const [a,b,after,pb,pa]=await Promise.all([smallJson(opts.handoff??opts.intake,opts.handoff?MAX_HANDOFF_BYTES:opts.after?2_000_000:undefined),smallJson(opts.terms),
    opts.after?smallJson(opts.after,2_000_000):null,opts.postBefore?smallJson(opts.postBefore,2_000_000):null,
    opts.postAfter?smallJson(opts.postAfter,2_000_000):null]);
  let packet;
  if(opts.handoff) {
    const handoff=await importRuntimeHandoff(a.raw.toString('utf8')),workspace=await parseWorkspace(handoff.workspaceText);
    packet=buildRuntimePacket({supportText:handoff.supportText,inputs:workspace.inputs},b.doc,opts.at);
    packet.runtimeSource={handoffSha256:digest(a.raw),workspaceSha256:digest(handoff.workspaceText),supportSha256:digest(handoff.supportText)};
  } else packet=buildPacket(a.doc,b.doc,digest(a.raw),opts.at,after?{after:after.doc,afterSha:digest(after.raw),
    postBefore:pb?.doc,postAfter:pa?.doc,postBeforeSha:pb?digest(pb.raw):undefined,postAfterSha:pa?digest(pa.raw):undefined}:null);
  await mkdir(opts.out,{mode:0o700}); // Never replace a prior acceptance packet.
  const output=[['packet.json',JSON.stringify(packet,null,2)+'\n'],['seller-packet.html',renderHtml(packet)],['acceptance-checklist.md',renderChecklist(packet)]];
  for(const [name,body] of output) await writeFile(path.join(opts.out,name),body,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({schema:SCHEMA,outputDir:path.resolve(opts.out),files:output.map(x=>x[0]),sourceSha256:packet.baseline.sourceSha256,readiness:packet.readiness,findings:packet.baseline.findings.length,repairClassification:packet.repairReview?.classification??null,...(packet.runtimeReview?{runtimeComparison:packet.runtimeReview.comparison.state}:{}),approvedFeeUsd:packet.commercial.approvedFeeUsd},null,2));
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) main().catch(e=>{console.error('SF77: '+e.message);process.exitCode=1;});

