#!/usr/bin/env node
// Public-source commercial opportunity -> independent specialist workshare.
// This is an offline decision-support tool; it cannot contact or charge anyone.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { receiptTime, exactUsdMinor, reconcileCollections, collectionQueueCsv } from './collections.mjs';
import { applyOutreachReview } from './outreach-board.mjs';
import { applyReplyReview } from './reply-review.mjs';
import { markdown as replyMarkdown } from './reply-triage.mjs';
import { resolveCommunicationAuthority } from './communication-authority.mjs';
import { importGmailCaptures, writeGmailCapture } from './gmail-capture.mjs';
import { applyContactHistory } from './contact-history.mjs';

const TYPES = new Set(['OPEN','CANCELLED','CLOSED','UNKNOWN']);
const PROOF = new Set(['DOCUMENTED','SELF_REPORTED','UNKNOWN']);
const safe = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = v => String(v ?? '').trim();
const uniq = xs => [...new Set(xs)];
const own = (obj,k) => Object.prototype.hasOwnProperty.call(obj,k);
// Engagement is about working an existing buyer relationship, not permission for a new introduction.
export function engagementDisplay(d) {
  if (d.outreachAuthority?.excluded) return 'OWNER CONTACT EXCLUSION';
  const s = d.replyTriage?.engagementLane;
  if (s === 'ACTIVE_CUSTOMER_REPLY') return 'ACTIVE CUSTOMER REPLY';
  if (s === 'REVIEW_HUMAN_REPLY') return 'REVIEW CUSTOMER REPLY';
  if (s === 'RECONNECT_NAMED_CONTACT') return 'RECONNECT NAMED CONTACT';
  if (s === 'FIX_DELIVERY') return 'FIX DELIVERY';
  if (s === 'CLOSED_DECLINED') return 'DECLINED CONTACT';
  if (s === 'READ_GMAIL_CONTENT') return 'READ CUSTOMER MESSAGE';
  const contactLane = d.contactHistory?.engagementLane;
  if (contactLane === 'COORDINATE_CONTACT') return 'CONTACT IN PROGRESS';
  if (contactLane === 'READ_CONTACT_HISTORY') return 'READ CONTACT HISTORY';
  if (s === 'AWAITING_REPLY' || contactLane === 'AWAITING_REPLY') return 'AWAITING CUSTOMER REPLY';
  if (s === 'REVIEW_FOLLOWUP' || contactLane === 'REVIEW_FOLLOWUP') return 'REVIEW FOLLOW-UP';
  return d.readyForOwnerApproach ? (d.outreachAuthority?.action === 'QUALIFY_PARTNER' ? 'QUALIFY PARTNER' : 'PROPOSE WORKSHARE') : 'RESOLVE INTRODUCTION ITEMS';
}
const introductionDisplay = d => d.contactHistory?.completedContacts || d.replyTriage?.sentCount
  ? 'ALREADY CONTACTED' : d.contactHistory?.reservedContacts ? 'CONTACT IN PROGRESS'
  : d.readyForOwnerApproach ? 'AUTHORIZED ACTION' : 'ITEMS TO RESOLVE';
const money = n => Number.isFinite(n) ? `$${n.toFixed(2)}` : 'UNSET';
const url = s => { try { const u=new URL(s); return u.protocol === 'https:' && !!u.hostname; } catch { return false; } };
const decimal = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const id = s => text(s).replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,90);
function insist(ok,msg) { if(!ok) throw Error(msg); }

const proposalCurrencies = new Set(Intl.supportedValuesOf('currency'));
function workshareMoney(share) {
  const explicit = ['currency','feeMinor','costMinor'].some(key => own(share,key));
  if (!explicit) {
    const fee = decimal(share.feeUsd) ? share.feeUsd : null;
    const cost = decimal(share.costUsd) ? share.costUsd : null;
    return { currency:'USD', moneyInput:'LEGACY_USD', minorUnitDigits:2,
      feeAmount:fee, costAmount:cost, feeUsd:fee, costUsd:cost,
      feeMinor:fee === 0 ? 0 : exactUsdMinor(fee), costMinor:cost === 0 ? 0 : exactUsdMinor(cost) };
  }
  const currency = text(share.currency).toUpperCase();
  insist(proposalCurrencies.has(currency), 'Workshare currency must be a supported ISO currency code');
  insist(share.feeUsd == null && share.costUsd == null, 'Use either currency/feeMinor/costMinor or legacy feeUsd/costUsd; do not mix amounts');
  const minor = (key) => {
    if (share[key] == null) return null;
    insist(Number.isSafeInteger(share[key]) && share[key] >= 0, 'Workshare '+key+' must be a nonnegative safe integer or null');
    return share[key];
  };
  const feeMinor = minor('feeMinor'), costMinor = minor('costMinor');
  const minorUnitDigits = new Intl.NumberFormat('en-US',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  const scale = 10 ** minorUnitDigits;
  const feeAmount = feeMinor === null ? null : feeMinor / scale;
  const costAmount = costMinor === null ? null : costMinor / scale;
  return {currency,moneyInput:'MINOR_UNITS',minorUnitDigits,feeMinor,costMinor,feeAmount,costAmount,
    feeUsd:currency === 'USD' ? feeAmount : null, costUsd:currency === 'USD' ? costAmount : null};
}
function worksharePrice(share,kind='fee') {
  if (share.moneyInput !== 'MINOR_UNITS') return money(share[kind+'Usd']);
  const value = share[kind+'Minor'];
  if (value === null) return 'UNSET';
  const digits = share.minorUnitDigits;
  const raw = BigInt(value).toString().padStart(digits + 1,'0');
  const whole = (digits ? raw.slice(0,-digits) : raw).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return share.currency+' '+whole+(digits ? '.'+raw.slice(-digits) : '');
}

export function evaluate(op, now = new Date(), options = {}) {
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
  const rolling = deadline.kind === 'ROLLING' && deadline.confirmed === true;
  const remainingHours = deadlineKnown ? (parsedDeadline.getTime() - now.getTime())/36e5 : null;
  const futureLocalDate = /^\d{4}-\d\d-\d\d$/.test(text(deadline.localDate)) &&
    Date.parse(deadline.localDate+'T00:00:00+14:00') > now.getTime();
  const due = rolling ? 'ROLLING' : !deadlineKnown ? 'TIMEZONE_OR_ISSUER_CONFIRMATION_REQUIRED' : remainingHours <= 0 ? 'EXPIRED' : `OPEN_${Math.ceil(remainingHours)}_HOURS`;
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
    return {name:p.name,eligibleToConsider:failures.length===0,documented:statuses.length-failures.length,required:statuses.length,gaps:failures,notes:p.notes||'',contactAuthorized:p.contactAuthorized===true,sourceUrl:p.sourceUrl||evidence.find(e=>url(e.sourceUrl))?.sourceUrl||null};
  });
  partners.sort((a,b)=>Number(b.eligibleToConsider)-Number(a.eligibleToConsider)||b.documented-a.documented||a.name.localeCompare(b.name));
  const best = partners.find(p=>p.eligibleToConsider);
  const share = op.workshare || {};
  const milestones = Array.isArray(share.milestones) ? share.milestones : [];
  const deliverable = milestones.length > 0 && milestones.every(m=>text(m.acceptance) && text(m.deliverable));
  const proposalMoney = workshareMoney(share);
  const fee = proposalMoney.feeAmount, costs = proposalMoney.costAmount;
  const margin = proposalMoney.moneyInput === 'MINOR_UNITS'
    ? proposalMoney.feeMinor > 0 && proposalMoney.costMinor !== null ? (proposalMoney.feeMinor-proposalMoney.costMinor)/proposalMoney.feeMinor : null
    : decimal(fee) && fee > 0 && decimal(costs) ? (fee-costs)/fee : null;
  const minimumMargin = op.minimumMargin ?? .25;
  const marginPolicyValid = decimal(minimumMargin) && minimumMargin < 1;
  const contact = op.communication || {};
  const authority = resolveCommunicationAuthority(op, options.communicationAuthority, now);
  const qualification = authority.action === 'QUALIFY_PARTNER';
  const requestedPartner = text(contact.partnerName);
  const targetPartner = requestedPartner ? partners.find(p=>p.name.toLowerCase()===requestedPartner.toLowerCase()) : (best || partners[0]);
  const feeApproved = share.feeStatus === 'OWNER_APPROVED_PROPOSAL';
  const standingProposal = authority.proposalAuthority && ['OWNER_STANDING','OWNER_EXACT'].includes(authority.kind) && share.feeStatus === 'PROPOSED';
  const feeUsableForProposal = feeApproved || standingProposal;
  const businessReady = marginPolicyValid && feeUsableForProposal && margin !== null && margin >= minimumMargin && deliverable;
  const authorized = authority.authorized;
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
  if(due === 'TIMEZONE_OR_ISSUER_CONFIRMATION_REQUIRED' && !(qualification&&futureLocalDate)) blockers.push('ISSUER_DEADLINE_CONFIRMATION');
  if(due === 'EXPIRED') blockers.push('EXPIRED');
  if(qualification) {
    if(!targetPartner || !url(targetPartner.sourceUrl)) blockers.push('PARTNER_SOURCE_NOT_RECORDED');
    if(!text(share.summary)) blockers.push('QUALIFICATION_PURPOSE_NOT_DEFINED');
  } else {
    if(!targetPartner?.eligibleToConsider) blockers.push('NO_PRIME_WITH_ALL_MANDATORY_DOCUMENTATION');
    if(!deliverable) blockers.push('NO_ACCEPTANCE_BASED_WORKSHARE');
    if(!marginPolicyValid) blockers.push('INVALID_MINIMUM_MARGIN_POLICY');
    if(!feeUsableForProposal) blockers.push('PROPOSAL_PRICE_AUTHORITY_NOT_RECORDED');
    if(!businessReady) blockers.push('FEES_COSTS_OR_MINIMUM_MARGIN_UNSET');
  }
  if(!authorized) blockers.push(...authority.reasons);
  if(requestedPartner && !targetPartner) blockers.push('NAMED_PARTNER_NOT_IN_CASE');
  const nextActions = [];
  if(!sourceReady) nextActions.push('Review original issuer solicitation and record source timestamp and exact clauses');
  if(!deadlineKnown&&!rolling) nextActions.push('Resolve deadline time zone and official confirmation before scheduling');
  if(buyer.status!=='OPEN') nextActions.push('Reconfirm this exact revision remains open; never reuse a cancelled edition');
  if(!targetPartner?.eligibleToConsider) nextActions.push(qualification ? 'Ask the prospective partner about the missing buyer requirements in the authorized qualification conversation' : 'Obtain buyer-specific prime eligibility documentation from the selected partner');
  if(!deliverable&&!qualification) nextActions.push('Define implementation milestones with objective acceptance');
  if(!businessReady&&!qualification) nextActions.push('Record the proposed fee, delivery costs, minimum margin and applicable proposal authority; use PROPOSED for a price under an existing owner sales directive');
  if(!authorized) nextActions.push(authority.excluded ? 'Respect the recorded owner contact exclusion and continue other authorized work' : 'Recover the applicable owner instruction; a standing directive can cover this action without another per-contact approval');
  if(!blockers.length) nextActions.unshift('Proceed with the authorized '+(qualification?'partner qualification conversation':'workshare proposal')+' after checking current recipient and send history');
  return {
    key,buyer:{name:buyer.name,id:buyer.opportunityId,revision:buyer.revision,status:buyer.status,sourceUrl:buyer.sourceUrl,deadlineText:deadline.originalText||'',deadlineIso:deadlineKnown?normalizedDeadline:null},
    owner:op.owner,sourceReview:sourceReady?'RECORDED_ISSUER_REVIEW':'UNREVIEWED',deadlineState:due,
    partners,selectedPrime:targetPartner?.name||null,primeQualificationComplete:!!targetPartner?.eligibleToConsider,workshare:{summary:share.summary||'',milestones,...proposalMoney,margin:margin===null?null:Number(margin.toFixed(4)),minimumMargin:marginPolicyValid?minimumMargin:null,feeStatus:share.feeStatus||'UNSET',feeApproved,feeUsableForProposal,feeAuthority:feeApproved?'OWNER_EXACT_PRICE':standingProposal?authority.kind:'UNRECORDED'},
    outreachAuthorized:authorized,outreachAuthority:authority,stage,recordedReceipts:validEvents,acceptedStageEvents,rejectedStageEvents,
    provenPaidUsd,recordedNetUsd:provenPaidUsd,cashReconciliation:'SINGLE_OPPORTUNITY_ONLY_NOT_DUPLICATE_CLEARED',
    readyForOwnerApproach:blockers.length===0,blockers,nextActions
  };
}

// Use the batch entry point for totals: transaction conflicts span opportunities.
export function evaluateAll(opportunities, now = new Date(), options = {}) {
  insist(Array.isArray(opportunities) && opportunities.length > 0, 'opportunities[] required');
  const decisions = opportunities.map(op => evaluate(op, now, options));
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
  const outreach = applyOutreachReview(opportunities, decisions, options.outreachSnapshot, now);
  const reply = applyReplyReview(opportunities, decisions, options.replySnapshot, now);
  const contactHistory = applyContactHistory(opportunities, decisions, options.contactRecords, now, reply);
  return { decisions, collections, outreach, reply, contactHistory };
}

export function renderMarkdown(rs,now){
  let out=`# Buyer-to-prime commercial decision board\n\nGenerated ${now.toISOString()}; all records are operator-supplied and require independent issuer/partner verification. Not bids, contracts or revenue.\n`;
  for(const r of rs){
    out+=`\n## ${r.buyer.name} · ${r.buyer.id} (${r.buyer.revision})\n\n`;
    out+=`**Owner:** ${r.owner} · **Stage:** ${r.stage} · **Decision:** ${engagementDisplay(r)} · **Recorded net USD:** ${money(r.recordedNetUsd)} (${r.cashReconciliation})\n\n`;
    if(r.outreachAuthority) out+=`**Contact authority:** ${r.outreachAuthority.kind}; ${r.outreachAuthority.action}; ${r.outreachAuthority.grantId||'legacy record'}.\n\n`;
    if (r.contactHistory) out+=`**Shared contact history:** ${r.contactHistory.status}; ${r.contactHistory.completedContacts} completed contact(s), ${r.contactHistory.providers.join(', ')||'no provider receipt'}, observed ${r.contactHistory.latestObservedAt||'not recorded'}. ${r.contactHistory.nextAction||'No completed contact in the supplied records'}.\n\n`;
    if (r.collections) out+=`**Collections:** ${r.collections.invoices.map(x=>`${x.invoiceId}: ${x.state}, ${x.outstandingMinor ?? 'unknown'} ${x.currency} minor units outstanding${x.overdue?' (overdue)':''}`).join('; ')||'No valid invoice recorded'}. Review required: ${r.collections.reviewRequired}.\n\n`;
    if (r.outreachPreflight) out+=`**Outreach snapshot:** ${r.outreachPreflight.decision}; ${r.outreachPreflight.reasons.join('; ')||'no collision observed in supplied snapshot; this is not send authorization'}.\n\n`;
    if (r.replyTriage) out+=`**First-contact eligibility:** ${introductionDisplay(r)}; **Reply status:** ${r.replyTriage.status}; ${r.replyTriage.sentCount??0} verified SENT, ${r.replyTriage.humanReplyCount??0} human, ${r.replyTriage.bounceCount??0} bounce. ${r.replyTriage.nextAction||'Provider reply snapshot not supplied or case not mapped'}.\n\n`;
    out+=`Source: ${r.buyer.sourceUrl}\n\nDeadline: ${r.buyer.deadlineText} (${r.deadlineState}). Source review: ${r.sourceReview}.\n\n`;
    out+=`Proposed specialist slice: ${r.workshare.summary||'UNDEFINED'}; fee ${worksharePrice(r.workshare)}, delivery cost ${worksharePrice(r.workshare,'cost')}, margin ${r.workshare.margin===null?'UNKNOWN':(100*r.workshare.margin).toFixed(1)+'%'}; ${r.workshare.feeStatus}.\n\n`;
    out+=`Prime fit: ${r.partners.map(p=>`${p.name} ${p.documented}/${p.required} documented requirements`).join('; ')||'UNASSIGNED'}\n\n`;
    out+='**Items to resolve:** '+(r.blockers.join('; ')||'none in supplied records')+'\n\n';
    out+='**Next operator moves:**\n'+r.nextActions.map(x=>`- ${x}`).join('\n')+'\n';
    if(r.workshare.milestones.length) out+='\n**Acceptance milestones:**\n'+r.workshare.milestones.map(m=>`- ${m.deliverable}: ${m.acceptance}`).join('\n')+'\n';
  }
  return out;
}

export function renderWorkshareSheet(rs,now){
  let out=`# Internal prime-led specialist workshare sheets\n\nGenerated ${now.toISOString()}. UNSENT OPERATOR MATERIAL. No bid, quote, contact, contract, payment or authorization is created by generating this file. Applicable owner authorization and current provider history determine the contact action; proposal and contracting readiness are assessed separately.\n`;
  for(const r of rs){
    out+=`\n---\n\n## ${r.buyer.name} | ${r.buyer.id} | ${r.buyer.revision}\n\n`;
    out+=`**Readiness for NEW introduction:** ${introductionDisplay(r)}; **existing-customer engagement:** ${engagementDisplay(r)}; **relationship owner:** ${r.owner}.\n\n`;
    out+=`**Buyer source:** ${r.buyer.sourceUrl}\n\n**Issuer deadline:** ${r.buyer.deadlineText} (${r.deadlineState}).\n\n`;
    out+=`**Potential contracting prime:** ${r.selectedPrime||'NO CANDIDATE RECORDED'}.\n\n`;
    out+=`**Specialist workshare:** ${r.workshare.summary||'NOT YET SCOPED'}.\n\n`;
    out+=`**Milestone acceptance schedule:**\n`;
    out+=r.workshare.milestones.length ? r.workshare.milestones.map((m,i)=>`${i+1}. Deliverable: ${m.deliverable}\n   Acceptance: ${m.acceptance}`).join('\n')+'\n' : 'No signed-off deliverables or acceptance yet.\n';
    out+=`\n**Externally usable fee:** ${r.workshare.feeUsableForProposal && Number.isFinite(r.workshare.feeAmount ?? r.workshare.feeUsd) ? worksharePrice(r.workshare)+' ('+r.workshare.feeAuthority+'; proposal only)' : 'NOT PROPOSED'}.\n\n`;
    out+=`**Partner fit:** ${r.partners.map(p=>`${p.name}: ${p.documented}/${p.required} mandatory clauses documented, ${p.eligibleToConsider?'potential candidate':'not qualified on provided records'}`).join('; ')||'No candidates assessed'}.\n\n`;
    if (r.contactHistory) out+=`**Shared contact history:** ${r.contactHistory.status}; ${r.contactHistory.channels.join(', ')||'no completed contact'}; observed ${r.contactHistory.latestObservedAt||'not recorded'}. ${r.contactHistory.nextAction||''}\n\n`;
    if (r.replyTriage) out+=`**Provider reply lane:** ${r.replyTriage.status}; ${r.replyTriage.nextAction||'Supply actual provider data and bind caseId before further contact'}.\n\n`;
    out+=`**Blocking items:** ${r.blockers.length?r.blockers.join('; '):'None in these supplied records; use the recorded owner authorization and current provider history'}.\n\n`;
    out+='**Next action:** '+(r.nextActions[0]||'Owner review real source, counterpart and commercial conditions')+'.\n';
  }
  return out;
}

export function renderHtml(rs,now){
  const blocks=rs.map(r=>{
    const authorityView=r.outreachAuthority?'<h3>Contact authority</h3><p>'+safe(r.outreachAuthority.kind)+' · '+safe(r.outreachAuthority.action)+' · '+safe(r.outreachAuthority.grantId||'legacy record')+'</p>':'';
    const contactView=r.contactHistory?`<h3>Shared contact history</h3><p><strong>${safe(r.contactHistory.status)}</strong> ${safe(r.contactHistory.completedContacts)} completed contact(s) · ${safe(r.contactHistory.providers.join(', ')||'No provider receipt')} · observed ${safe(r.contactHistory.latestObservedAt||'not recorded')}.</p><p>${safe(r.contactHistory.nextAction||'No completed contact in the supplied records.')}</p>`:'';
    const collectionRows=(r.collections?.invoices||[]).map(x=>`<tr><td>${safe(x.invoiceId)}</td><td>${safe(x.currency)}</td><td>${safe(x.netMinor)}</td><td>${safe(x.outstandingMinor??'Unknown')}</td><td>${safe(x.state)}${x.overdue?' · overdue':''}</td></tr>`).join('');
    const collectionView=r.collections?`<h3>Recorded collections</h3><p>Workflow stage is separate from invoice settlement. Integer minor units per stated currency; no currency conversion. ${r.collections.reviewRequired?'Review required: see collections.json for rejected or conflicting receipts.':'Receipts remain operator supplied; independently verify with the provider.'}</p><table><tr><th>Invoice</th><th>Currency</th><th>Net received</th><th>Outstanding</th><th>State</th></tr>${collectionRows||'<tr><td colspan="5">No valid invoice recorded</td></tr>'}</table>`:'';
    const outreachView=r.outreachPreflight?`<h3>Outreach snapshot</h3><p>${safe(r.outreachPreflight.decision)}: ${safe(r.outreachPreflight.reasons.join('; ')||'No collision observed in supplied snapshot. Separate live checks, reservation and owner authorization still apply.')}</p>`:'';
    const replyView=r.replyTriage?`<h3>Provider reply lane</h3><p><strong>${safe(r.replyTriage.engagementLane||'PROVIDER DATA NOT SUPPLIED')}</strong> · ${safe(r.replyTriage.status)}</p><p><strong>Original introduction: ${introductionDisplay(r)}</strong> · ${safe(r.replyTriage.sentCount??0)} verified SENT · ${safe(r.replyTriage.humanReplyCount??0)} human · ${safe(r.replyTriage.bounceCount??0)} bounce.</p><p>${safe(r.replyTriage.nextAction||'No mapped provider reply data. Use the relationship owner and actual mailbox receipts.')}</p>`:'';
    const workshareView=`<h3>Implementation workshare</h3><p>${safe(r.workshare.summary||'Scope not recorded')}</p><p>Fee: ${safe(worksharePrice(r.workshare))} · ${safe(r.workshare.feeStatus)} · ${safe(r.workshare.feeAuthority)}. Delivery cost: ${safe(worksharePrice(r.workshare,'cost'))}.</p><ol>${r.workshare.milestones.map(m=>`<li><b>${safe(m.deliverable)}</b>: ${safe(m.acceptance)}</li>`).join('')}</ol>`;
    const issues=r.blockers.map(s=>`<li>${safe(s)}</li>`).join('');
    const partnerRows=r.partners.map(p=>`<tr><td>${safe(p.name)}</td><td>${p.documented}/${p.required}</td><td>${p.eligibleToConsider?'DOCUMENTED':'ASK PARTNER'}</td><td>${safe(p.gaps.map(g=>g.requirementId).join(', '))}</td></tr>`).join('');
    return `<section><div class="top"><h2>${safe(r.buyer.name)}</h2><span class="status">${safe(engagementDisplay(r))}</span></div><p>${safe(r.buyer.id)} · ${safe(r.buyer.revision)} · ${safe(r.owner)} · Workflow: ${safe(r.stage)}</p><p>Cash basis: ${safe(r.cashReconciliation)}; operator-recorded, not provider-verified.</p><p><a href="${safe(r.buyer.sourceUrl)}">First-party source</a> · ${safe(r.deadlineState)}</p><div class="metrics"><div><label>Documented prime</label><strong>${safe(r.selectedPrime||'Not selected')}</strong></div><div><label>Price</label><strong>${safe(worksharePrice(r.workshare))}</strong></div><div><label>Recorded net USD</label><strong>${safe(money(r.recordedNetUsd))}</strong></div></div>${authorityView}${contactView}${collectionView}${outreachView}${replyView}${workshareView}<h3>Mandatory prime requirements</h3><table><tr><th>Candidate</th><th>Documented</th><th>Gate</th><th>Missing</th></tr>${partnerRows}</table><h3>Items to resolve</h3><ul>${issues||'<li>None recorded</li>'}</ul><h3>Next actions</h3><ol>${r.nextActions.map(s=>`<li>${safe(s)}</li>`).join('')}</ol></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buyer-to-prime operator board</title><style>:root{font-family:system-ui,-apple-system,sans-serif;color:#222;background:#f4f4f4}body{max-width:1090px;margin:38px auto;padding:0 18px}h1{font-size:2rem}p{line-height:1.5;color:#444}section{background:#fff;padding:28px;border:1px solid #ccc;border-radius:3px;margin:20px 0}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.top h2{margin:0}.status{font-weight:700;color:#222;background:#eee;padding:8px 12px;border-radius:3px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:22px 0}.metrics div{padding:16px;background:#f5f5f5;border-radius:2px}label{display:block;font-size:.8rem;color:#555;margin-bottom:8px}strong{display:block;font-size:1.1rem;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;text-align:left}td,th{border-bottom:1px solid #ccc;padding:10px 6px;overflow-wrap:anywhere}th{color:#444}li{line-height:1.5;margin:7px 0}a{color:#222}.disclaimer{padding:16px;border-left:4px solid #666}</style><main><h1>Buyer → prime → paid work</h1><p class="disclaimer">Offline operator decision board, generated ${safe(now.toISOString())}. Documentation status is declared by inputs, not validated by this program. Nothing is submitted, contacted, purchased or paid.</p>${blocks}</main></html>`;
}

async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')||args.length===0){console.log('Usage: node pipeline.mjs <opportunities.json> <output-dir> [--now=ISO] [--outreach-snapshot=path.json] [--reply-snapshot=path.json | --gmail-captures=path.json] [--previous-mailbox=path.json] [--contact-records=path.json]');return;}
  insist(args.length>=2,'Provide input and output directory');
  const raw=JSON.parse(await readFile(args[0],'utf8'));
  insist(Array.isArray(raw.opportunities) && raw.opportunities.length>0,'opportunities[] required');
  const override=args.find(x=>x.startsWith('--now='));
  const now=new Date(override?override.slice(6):Date.now());
  insist(!Number.isNaN(now.getTime()),'Invalid --now');
  const snapshotArg=args.find(x=>x.startsWith('--outreach-snapshot='));
  const outreachSnapshot=snapshotArg?JSON.parse(await readFile(snapshotArg.slice('--outreach-snapshot='.length),'utf8')):undefined;
  const replyArg=args.find(x=>x.startsWith('--reply-snapshot='));
  const gmailArg=args.find(x=>x.startsWith('--gmail-captures='));
  insist(!(replyArg&&gmailArg),'Choose native Gmail captures or an existing reply snapshot');
  const previousArg=args.find(x=>x.startsWith('--previous-mailbox='));
  insist(!previousArg||gmailArg,'--previous-mailbox requires --gmail-captures');
  const native=gmailArg?importGmailCaptures(JSON.parse(await readFile(gmailArg.slice('--gmail-captures='.length),'utf8')),{
    previous:previousArg?JSON.parse(await readFile(previousArg.slice('--previous-mailbox='.length),'utf8')):undefined,now
  }):null;
  const replySnapshot=native?.replySnapshot??(replyArg?JSON.parse(await readFile(replyArg.slice('--reply-snapshot='.length),'utf8')):undefined);
  const contactArg=args.find(x=>x.startsWith('--contact-records='));
  const contactRecords=contactArg?JSON.parse(await readFile(contactArg.slice('--contact-records='.length),'utf8')):undefined;
  const { decisions: rs, collections, outreach, reply, contactHistory } = evaluateAll(raw.opportunities,now,{outreachSnapshot,replySnapshot,contactRecords,communicationAuthority:raw.communicationAuthority});
  const out=path.resolve(args[1]);
  await mkdir(out,{recursive:true,mode:0o700});
  if(native) await writeGmailCapture(native,out);
  await writeFile(path.join(out,'decisions.json'),JSON.stringify({generatedAt:now.toISOString(),opportunities:rs},null,2)+'\n');
  await writeFile(path.join(out,'decision-board.md'),renderMarkdown(rs,now));
  await writeFile(path.join(out,'workshare-sheet.md'),renderWorkshareSheet(rs,now));
  await writeFile(path.join(out,'index.html'),renderHtml(rs,now));
  await writeFile(path.join(out,'collections.json'),JSON.stringify(collections,null,2)+'\n');
  await writeFile(path.join(out,'collection-queue.csv'),collectionQueueCsv(collections));
  await writeFile(path.join(out,'outreach-preflight.json'),JSON.stringify(outreach??{generatedAt:now.toISOString(),decision:'NOT_EVALUATED',reason:'NO_MAILBOX_SNAPSHOT_SUPPLIED'},null,2)+'\n');
  await writeFile(path.join(out,'reply-queue.json'),JSON.stringify(reply??{generatedAt:now.toISOString(),status:'NOT_EVALUATED',reason:'NO_PROVIDER_REPLY_SNAPSHOT_SUPPLIED'},null,2)+'\n');
  await writeFile(path.join(out,'reply-queue.md'),reply?replyMarkdown(reply):'# Reply status\n\nNot evaluated: no provider reply snapshot supplied. This is not evidence that no email was sent.\n');
  if(contactHistory) await writeFile(path.join(out,'contact-history.json'),JSON.stringify(contactHistory,null,2)+'\n');
  console.log(JSON.stringify({generatedAt:now.toISOString(),fileCount:(native?12:9)+(contactHistory?1:0),canonicalContacts:contactHistory?.records.filter(record=>record.completed).length??null,contactReadIssues:contactHistory?.issues.length??null,mailboxCaptures:native?.coverage.captureCount??null,mailboxContinuations:native?.coverage.continuations.length??null,opportunities:rs.length,alreadyContacted:rs.filter(r=>introductionDisplay(r)==='ALREADY CONTACTED').length,hold:rs.filter(r=>!r.readyForOwnerApproach).length,ownerReview:rs.filter(r=>r.readyForOwnerApproach).length,recordedCash:(collections.currencies.find(c=>c.currency==='USD')?.netMinor??0)/100,recordedByCurrency:collections.currencies,collectionReviewItems:collections.issues.length,replyInterestCases:reply?.totals?.interestCases??null,replyMappingIssues:reply?.boardJoin?.issues.length??null,outputDir:out},null,2));
}
if(process.argv[1] && import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href){main().catch(e=>{console.error(e.message);process.exitCode=1;});}
