#!/usr/bin/env node
// Public-source commercial opportunity -> independent specialist workshare.
// This is an offline decision-support tool; it cannot contact or charge anyone.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { receiptTime, exactUsdMinor, reconcileCollections, collectionQueueCsv } from './collections.mjs';

const TYPES = new Set(['OPEN','CANCELLED','CLOSED','UNKNOWN']);
const PROOF = new Set(['DOCUMENTED','SELF_REPORTED','UNKNOWN']);
const safe = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = v => String(v ?? '').trim();
const uniq = xs => [...new Set(xs)];
const own = (obj,k) => Object.prototype.hasOwnProperty.call(obj,k);
const money = n => Number.isFinite(n) ? `$${n.toFixed(2)}` : 'UNSET';
const url = s => { try { const u=new URL(s); return u.protocol === 'https:' && !!u.hostname; } catch { return false; } };
const decimal = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const id = s => text(s).replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,90);
function insist(ok,msg) { if(!ok) throw Error(msg); }

export function evaluate(op, now = new Date()) {
  insist(now instanceof Date && Number.isFinite(now.getTime()), 'Invalid assessment time');
  insist(op && typeof op === 'object' && !Array.isArray(op), 'Opportunity must be an object');
  const buyer = op.buyer || {};
  insist(text(buyer.name) && text(buyer.opportunityId) && text(buyer.revision), 'Buyer name, ID, and revision required');
  insist(TYPES.has(buyer.status), 'Explicit OPEN/CANCELLED/CLOSED/UNKNOWN buyer status required');
  insist(url(buyer.sourceUrl), 'Buyer issuer source must be an HTTPS URL');
  insist(text(op.owner), 'Named internal opportunity owner required');
  const key = [buyer.name.toLowerCase().replace(/\s+/g,' ').trim(), text(buyer.opportunityId).toLowerCase(), text(buyer.revision).toLowerCase()].join('::');
  const sourceCheck = op.sourceCheck || {};
  const sourceReady = sourceCheck.method === 'ISSUER_REVIEW' && text(sourceCheck.checkedAt) && text(sourceCheck.detail);
  const deadline = buyer.deadline || {};
  const normalizedDeadline = text(deadline.isoWithOffset);
  const parsedDeadline = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?[+-]\d\d:\d\d$/.test(normalizedDeadline) ? new Date(normalizedDeadline) : null;
  const deadlineKnown = parsedDeadline && !Number.isNaN(parsedDeadline.getTime()) && deadline.confirmed === true;
  const remainingHours = deadlineKnown ? (parsedDeadline.getTime() - now.getTime())/36e5 : null;
  const due = !deadlineKnown ? 'TIMEZONE_OR_ISSUER_CONFIRMATION_REQUIRED' : remainingHours <= 0 ? 'EXPIRED' : `OPEN_${Math.ceil(remainingHours)}_HOURS`;
  const requirements = op.requirements || [];
  insist(Array.isArray(requirements) && requirements.length, 'One or more buyer requirements required');
  insist(new Set(requirements.map(r=>r.id)).size === requirements.length, 'Duplicate requirement ID');
  const mandatory = requirements.filter(r=>r.mandatory === true);
  const partners = (op.partners || []).map(p=>{
    insist(text(p.name), 'Named partner or explicit UNASSIGNED required');
    const evidence = Array.isArray(p.evidence) ? p.evidence : [];
    const statuses = mandatory.map(r=>{
      const e=evidence.find(i=>i.requirementId === r.id);
      const level= e && PROOF.has(e.status) ? e.status : 'UNKNOWN';
      return {requirementId:r.id,status:level,sourceUrl:e?.sourceUrl||null,valid:level==='DOCUMENTED'&&url(e?.sourceUrl)};
    });
    const failures=statuses.filter(x=>!x.valid);
    return {name:p.name,eligibleToConsider:failures.length===0,documented:statuses.length-failures.length,required:statuses.length,gaps:failures,notes:p.notes||'',contactAuthorized:p.contactAuthorized===true};
  });
  partners.sort((a,b)=>Number(b.eligibleToConsider)-Number(a.eligibleToConsider)||b.documented-a.documented||a.name.localeCompare(b.name));
  const best = partners.find(p=>p.eligibleToConsider);
  const share = op.workshare || {};
  const milestones = Array.isArray(share.milestones) ? share.milestones : [];
  const deliverable = milestones.length > 0 && milestones.every(m=>text(m.acceptance) && text(m.deliverable));
  const fee = share.feeUsd;
  const costs = share.costUsd;
  const margin = decimal(fee) && fee > 0 && decimal(costs) ? (fee-costs)/fee : null;
  const minimumMargin = op.minimumMargin ?? .25;
  const marginPolicyValid = decimal(minimumMargin) && minimumMargin < 1;
  const feeApproved = share.feeStatus === 'OWNER_APPROVED_PROPOSAL';
  // A guessed price, negative policy threshold or mathematically positive margin is not quote authority.
  const businessReady = marginPolicyValid && feeApproved && margin !== null && margin >= minimumMargin && deliverable;
  const contact = op.communication || {};
  const authorized = contact.ownerApproved === true && contact.doNotContact !== true && !!text(contact.approvalReceipt);
  const stageEvents = Array.isArray(op.events) ? op.events : [];
  const allowedEvents = new Set(['BUYER_CONFIRMED','PRIME_CONFIRMED','PARTNER_REPLIED','SOW_SIGNED','INVOICE_SENT','PAYMENT_CONFIRMED']);
  const stages = ['SOURCED','BUYER_CONFIRMED','PRIME_CONFIRMED','PARTNER_REPLIED','SOW_SIGNED','INVOICE_SENT','PAYMENT_CONFIRMED'];
  let stageIndex=0;
  let recordedPaidUsd=0;
  let lastEventAt=0;
  const validEvents=[];
  const acceptedStageEvents=[];
  const rejectedStageEvents=[];
  for(const e of stageEvents){
    if (!e || typeof e !== 'object') { rejectedStageEvents.push({code:'INVALID_EVENT'}); continue; }
    if(!allowedEvents.has(e.kind)) continue;
    if(stages[stageIndex+1] !== e.kind || !url(e.receiptUrl)) { rejectedStageEvents.push({kind:e.kind,code:'STAGE_ORDER_OR_RECEIPT_INVALID'}); continue; }
    const at = receiptTime(e.timestamp);
    if(!Number.isFinite(at) || at < lastEventAt || at > now.getTime()) { rejectedStageEvents.push({kind:e.kind,code:'INVALID_OUT_OF_ORDER_OR_FUTURE_TIME'}); continue; }
    if(e.kind==='PAYMENT_CONFIRMED' && !(exactUsdMinor(e.amountUsd)!==null&&text(e.transactionId))) { rejectedStageEvents.push({kind:e.kind,code:'PAYMENT_FIELDS_INVALID'}); continue; }
    validEvents.push(e.kind);
    acceptedStageEvents.push({...e});
    stageIndex++;
    lastEventAt=at;
    if(e.kind==='PAYMENT_CONFIRMED') recordedPaidUsd=e.amountUsd;
  }
  const stage=stages[stageIndex];
  const provenPaidUsd = stage === 'PAYMENT_CONFIRMED' ? recordedPaidUsd : 0;
  const blockers = [];
  if(buyer.status !== 'OPEN') blockers.push(`BUYER_STATUS_${buyer.status}`);
  if(!sourceReady) blockers.push('FIRST_PARTY_SOURCE_REVIEW_MISSING');
  if(due === 'TIMEZONE_OR_ISSUER_CONFIRMATION_REQUIRED') blockers.push('ISSUER_DEADLINE_CONFIRMATION');
  if(due === 'EXPIRED') blockers.push('EXPIRED');
  if(!best) blockers.push('NO_PRIME_WITH_ALL_MANDATORY_DOCUMENTATION');
  if(!deliverable) blockers.push('NO_ACCEPTANCE_BASED_WORKSHARE');
  if(!marginPolicyValid) blockers.push('INVALID_MINIMUM_MARGIN_POLICY');
  if(!feeApproved) blockers.push('PROPOSAL_FEE_NOT_OWNER_APPROVED');
  if(!businessReady) blockers.push('FEES_COSTS_OR_MINIMUM_MARGIN_UNSET');
  if(!authorized) blockers.push('OWNER_CONTACT_APPROVAL_REQUIRED');
  const nextActions = [];
  if(!sourceReady) nextActions.push('Review original issuer solicitation and record source timestamp and exact clauses');
  if(!deadlineKnown) nextActions.push('Resolve deadline time zone and official confirmation before scheduling');
  if(buyer.status!=='OPEN') nextActions.push('Reconfirm this exact revision remains open; never reuse a cancelled edition');
  if(!best) nextActions.push('Obtain buyer-specific prime eligibility documentation from a qualified partner');
  if(!deliverable) nextActions.push('Define bounded QA/implementation milestones with objective acceptance');
  if(!businessReady) nextActions.push('Verify proposed fee and delivery costs, owner-approve proposal price (feeStatus OWNER_APPROVED_PROPOSAL), and record minimum margin of 0–99.99%; internal estimate is not an offer');
  if(!authorized) nextActions.push('Obtain named owner approval and receipt before any external contact');
  if(!blockers.length) nextActions.push('Owner may authorize one tailored unsent prime approach; no automatic sending');
  return {
    key,buyer:{name:buyer.name,id:buyer.opportunityId,revision:buyer.revision,status:buyer.status,sourceUrl:buyer.sourceUrl,deadlineText:deadline.originalText||'',deadlineIso:deadlineKnown?normalizedDeadline:null},
    owner:op.owner,sourceReview:sourceReady?'RECORDED_ISSUER_REVIEW':'UNREVIEWED',deadlineState:due,
    partners,selectedPrime:best?.name||null,workshare:{summary:share.summary||'',milestones,feeUsd:decimal(fee)?fee:null,costUsd:decimal(costs)?costs:null,margin:margin===null?null:Number(margin.toFixed(4)),minimumMargin:marginPolicyValid?minimumMargin:null,feeStatus:share.feeStatus||'UNSET',feeApproved},
    outreachAuthorized:authorized,stage,recordedReceipts:validEvents,acceptedStageEvents,rejectedStageEvents,
    provenPaidUsd,recordedNetUsd:provenPaidUsd,cashReconciliation:'SINGLE_OPPORTUNITY_ONLY_NOT_DUPLICATE_CLEARED',
    readyForOwnerApproach:blockers.length===0,blockers,nextActions
  };
}

// Use the batch entry point for totals: transaction conflicts span opportunities.
export function evaluateAll(opportunities, now = new Date()) {
  insist(Array.isArray(opportunities) && opportunities.length > 0, 'opportunities[] required');
  const decisions = opportunities.map(op => evaluate(op, now));
  insist(uniq(decisions.map(r=>r.key)).length === decisions.length, 'Duplicate buyer+opportunity+revision; merge ownership before proceeding');
  const collections = reconcileCollections(opportunities, decisions, now);
  decisions.forEach((decision, i) => {
    const collection = collections.byOpportunity[i];
    decision.recordedNetUsd = collection.recordedNetUsd;
    decision.provenPaidUsd = collection.recordedNetUsd; // Compatibility name; never provider-verified.
    decision.cashReconciliation = 'BATCH_RECONCILED_OPERATOR_RECORDS';
    decision.collections = collection;
    if (decision.stage === 'PAYMENT_CONFIRMED' && !collection.currencies.some(c=>c.netMinor > 0)) decision.stage = 'INVOICE_SENT';
    if (collection.reviewRequired) decision.nextActions.unshift('Review quarantined collection receipts in collections.json; no automatic collection or contact');
  });
  return { decisions, collections };
}

export function renderMarkdown(rs,now){
  let out=`# Buyer-to-prime commercial decision board\n\nGenerated ${now.toISOString()}; all records are operator-supplied and require independent issuer/partner verification. Not bids, contracts or revenue.\n`;
  for(const r of rs){
    out+=`\n## ${r.buyer.name} · ${r.buyer.id} (${r.buyer.revision})\n\n`;
    out+=`**Owner:** ${r.owner} · **Stage:** ${r.stage} · **Decision:** ${r.readyForOwnerApproach?'OWNER_APPROACH_CANDIDATE':'HOLD'} · **Recorded net USD:** ${money(r.recordedNetUsd)} (${r.cashReconciliation})\n\n`;
    if (r.collections) out+=`**Collections:** ${r.collections.invoices.map(x=>`${x.invoiceId}: ${x.state}, ${x.outstandingMinor ?? 'unknown'} ${x.currency} minor units outstanding${x.overdue?' (overdue)':''}`).join('; ')||'No valid invoice recorded'}. Review required: ${r.collections.reviewRequired}.\n\n`;
    out+=`Source: ${r.buyer.sourceUrl}\n\nDeadline: ${r.buyer.deadlineText} (${r.deadlineState}). Source review: ${r.sourceReview}.\n\n`;
    out+=`Proposed specialist slice: ${r.workshare.summary||'UNDEFINED'}; fee ${money(r.workshare.feeUsd)}, delivery cost ${money(r.workshare.costUsd)}, margin ${r.workshare.margin===null?'UNKNOWN':(100*r.workshare.margin).toFixed(1)+'%'}; ${r.workshare.feeStatus}.\n\n`;
    out+=`Prime fit: ${r.partners.map(p=>`${p.name} ${p.documented}/${p.required} documented requirements`).join('; ')||'UNASSIGNED'}\n\n`;
    out+='**Blocking gates:** '+(r.blockers.join('; ')||'none; owner release remains separate')+'\n\n';
    out+='**Next operator moves:**\n'+r.nextActions.map(x=>`- ${x}`).join('\n')+'\n';
    if(r.workshare.milestones.length) out+='\n**Acceptance milestones:**\n'+r.workshare.milestones.map(m=>`- ${m.deliverable}: ${m.acceptance}`).join('\n')+'\n';
  }
  return out;
}

export function renderWorkshareSheet(rs,now){
  let out=`# Internal prime-led specialist workshare sheets\n\nGenerated ${now.toISOString()}. UNSENT OPERATOR MATERIAL. No bid, quote, contact, contract, payment or authorization is created by generating this file. Human review and a qualified contracting prime are always required.\n`;
  for(const r of rs){
    out+=`\n---\n\n## ${r.buyer.name} | ${r.buyer.id} | ${r.buyer.revision}\n\n`;
    out+=`**Approval state:** ${r.readyForOwnerApproach?'INTERNAL OWNER REVIEW ONLY':'HOLD'}; **relationship owner:** ${r.owner}.\n\n`;
    out+=`**Buyer source:** ${r.buyer.sourceUrl}\n\n**Issuer deadline:** ${r.buyer.deadlineText} (${r.deadlineState}).\n\n`;
    out+=`**Potential contracting prime:** ${r.selectedPrime||'NONE QUALIFIED IN PROVIDED DOCUMENTARY EVIDENCE'}.\n\n`;
    out+=`**Specialist workshare:** ${r.workshare.summary||'NOT YET SCOPED'}.\n\n`;
    out+=`**Milestone acceptance schedule:**\n`;
    out+=r.workshare.milestones.length ? r.workshare.milestones.map((m,i)=>`${i+1}. Deliverable: ${m.deliverable}\n   Acceptance: ${m.acceptance}`).join('\n')+'\n' : 'No signed-off deliverables or acceptance yet.\n';
    out+=`\n**Externally usable fee:** ${r.workshare.feeApproved && r.workshare.feeUsd !== null ? money(r.workshare.feeUsd)+' (internal approval recorded; offer remains UNSENT)' : 'WITHHELD: OWNER HAS NOT APPROVED PRICE'}.\n\n`;
    out+=`**Partner fit:** ${r.partners.map(p=>`${p.name}: ${p.documented}/${p.required} mandatory clauses documented, ${p.eligibleToConsider?'potential candidate':'not qualified on provided records'}`).join('; ')||'No candidates assessed'}.\n\n`;
    out+=`**Blocking items:** ${r.blockers.length?r.blockers.join('; '):'None in these supplied records; separate sender/recipient review is still required'}.\n\n`;
    out+='**Human next action:** '+(r.nextActions[0]||'Owner review real source, counterpart and commercial conditions')+'; independently confirm original buyer and partner permissions before any communication.\n';
  }
  return out;
}

export function renderHtml(rs,now){
  const blocks=rs.map(r=>{
    const collectionRows=(r.collections?.invoices||[]).map(x=>`<tr><td>${safe(x.invoiceId)}</td><td>${safe(x.currency)}</td><td>${safe(x.netMinor)}</td><td>${safe(x.outstandingMinor??'Unknown')}</td><td>${safe(x.state)}${x.overdue?' · overdue':''}</td></tr>`).join('');
    const collectionView=r.collections?`<h3>Recorded collections</h3><p>Workflow stage is separate from invoice settlement. Integer minor units per stated currency; no currency conversion. ${r.collections.reviewRequired?'Review required: see collections.json for rejected or conflicting receipts.':'Receipts remain operator supplied; independently verify with the provider.'}</p><table><tr><th>Invoice</th><th>Currency</th><th>Net received</th><th>Outstanding</th><th>State</th></tr>${collectionRows||'<tr><td colspan="5">No valid invoice recorded</td></tr>'}</table>`:'';
    const issues=r.blockers.map(s=>`<li>${safe(s)}</li>`).join('');
    const partnerRows=r.partners.map(p=>`<tr><td>${safe(p.name)}</td><td>${p.documented}/${p.required}</td><td>${p.eligibleToConsider?'DOCUMENTED':'HOLD'}</td><td>${safe(p.gaps.map(g=>g.requirementId).join(', '))}</td></tr>`).join('');
    return `<section><div class="top"><h2>${safe(r.buyer.name)}</h2><span class="status">${r.readyForOwnerApproach?'OWNER REVIEW':'HOLD'}</span></div><p>${safe(r.buyer.id)} · ${safe(r.buyer.revision)} · ${safe(r.owner)} · Workflow: ${safe(r.stage)}</p><p>Cash basis: ${safe(r.cashReconciliation)}; operator-recorded, not provider-verified.</p><p><a href="${safe(r.buyer.sourceUrl)}">First-party source</a> · ${safe(r.deadlineState)}</p><div class="metrics"><div><label>Documented prime</label><strong>${safe(r.selectedPrime||'Not qualified')}</strong></div><div><label>Price</label><strong>${safe(money(r.workshare.feeUsd))}</strong></div><div><label>Recorded net USD</label><strong>${safe(money(r.recordedNetUsd))}</strong></div></div>${collectionView}<h3>Mandatory prime requirements</h3><table><tr><th>Candidate</th><th>Documented</th><th>Gate</th><th>Missing</th></tr>${partnerRows}</table><h3>Blocking gates</h3><ul>${issues||'<li>None recorded; release remains with owner</li>'}</ul><h3>Next actions</h3><ol>${r.nextActions.map(s=>`<li>${safe(s)}</li>`).join('')}</ol></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buyer-to-prime operator board</title><style>:root{font-family:system-ui,-apple-system,sans-serif;color:#19263c;background:#f4f6fa}body{max-width:1090px;margin:38px auto;padding:0 18px}h1{font-size:2rem}p{line-height:1.5;color:#44536a}section{background:#fff;padding:28px;border-radius:16px;box-shadow:0 8px 30px #15254112;margin:20px 0}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.top h2{margin:0}.status{font-weight:700;color:#763600;background:#ffefd7;padding:8px 12px;border-radius:9px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:22px 0}.metrics div{padding:16px;background:#f1f5fa;border-radius:10px}label{display:block;font-size:.8rem;color:#637085;margin-bottom:8px}strong{display:block;font-size:1.1rem;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;text-align:left}td,th{border-bottom:1px solid #dce2eb;padding:10px 6px;overflow-wrap:anywhere}th{color:#4b5a71}li{line-height:1.5;margin:7px 0}a{color:#075fba}.disclaimer{padding:16px;border-left:4px solid #59708a}</style><main><h1>Buyer → prime → paid work</h1><p class="disclaimer">Offline operator decision board, generated ${safe(now.toISOString())}. Documentation status is declared by inputs, not validated by this program. Nothing is submitted, contacted, purchased or paid.</p>${blocks}</main></html>`;
}

async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')||args.length===0){console.log('Usage: node pipeline.mjs <opportunities.json> <output-dir> [--now=ISO]');return;}
  insist(args.length>=2,'Provide input and output directory');
  const raw=JSON.parse(await readFile(args[0],'utf8'));
  insist(Array.isArray(raw.opportunities) && raw.opportunities.length>0,'opportunities[] required');
  const override=args.find(x=>x.startsWith('--now='));
  const now=new Date(override?override.slice(6):Date.now());
  insist(!Number.isNaN(now.getTime()),'Invalid --now');
  const { decisions: rs, collections } = evaluateAll(raw.opportunities,now);
  const out=path.resolve(args[1]);
  await mkdir(out,{recursive:true});
  await writeFile(path.join(out,'decisions.json'),JSON.stringify({generatedAt:now.toISOString(),opportunities:rs},null,2)+'\n');
  await writeFile(path.join(out,'decision-board.md'),renderMarkdown(rs,now));
  await writeFile(path.join(out,'workshare-sheet.md'),renderWorkshareSheet(rs,now));
  await writeFile(path.join(out,'index.html'),renderHtml(rs,now));
  await writeFile(path.join(out,'collections.json'),JSON.stringify(collections,null,2)+'\n');
  await writeFile(path.join(out,'collection-queue.csv'),collectionQueueCsv(collections));
  console.log(JSON.stringify({generatedAt:now.toISOString(),fileCount:6,opportunities:rs.length,hold:rs.filter(r=>!r.readyForOwnerApproach).length,ownerReview:rs.filter(r=>r.readyForOwnerApproach).length,recordedCash:(collections.currencies.find(c=>c.currency==='USD')?.netMinor??0)/100,recordedByCurrency:collections.currencies,collectionReviewItems:collections.issues.length,outputDir:out},null,2));
}
if(process.argv[1] && import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href){main().catch(e=>{console.error(e.message);process.exitCode=1;});}
