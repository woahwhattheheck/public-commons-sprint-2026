#!/usr/bin/env node
// Copyright 2026 TokenJunkieLabs. Offline commercial workshare assembly; no sends or payments.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {evaluate} from '../lead-to-paid-work-pipeline-20261010/pipeline.mjs';

const txt=v=>String(v??'').trim();
const esc=v=>txt(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md=v=>txt(v).replace(/([\\`*_{}\[\]<>|])/g,'\\$1').replace(/\r?\n/g,' ');
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const fail=msg=>{throw Error(msg);};
const requireTrue=(v,msg)=>{if(!v)fail(msg);};
const https=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}};
const usd=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<1e-7;
const dollars=n=>usd(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n):'Awaiting owner-approved price';
const csv=v=>{let s=txt(v).replace(/\r?\n/g,' ');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const tidy=v=>Array.isArray(v)?v.filter(x=>txt(x)).map(x=>txt(x).slice(0,1000)):[];
const max=(v,n,label)=>{requireTrue(txt(v).length<=n,label+' too long');return txt(v)};
function args(argv){const a={};for(let i=0;i<argv.length;i++){const t=argv[i];requireTrue(/^--[a-z-]+$/.test(t)&&!Object.hasOwn(a,t),'Unexpected or duplicated flag: '+t);requireTrue(i+1<argv.length && !argv[i+1].startsWith('--'),'Missing value: '+t);a[t]=argv[++i];}for(const k of Object.keys(a))requireTrue(['--opportunities','--terms','--id','--out','--at'].includes(k),'Unknown flag: '+k);for(const k of ['--opportunities','--terms','--id','--out'])requireTrue(a[k],'Required: '+k);return a;}
async function load(file){const raw=await readFile(file);requireTrue(raw.length>0&&raw.length<=2_000_000,'Input JSON must be 1..2000000 bytes');return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}

export function composeOffer(op, terms, now=new Date()){
  requireTrue(op&&typeof op==='object'&&terms&&typeof terms==='object'&&!Array.isArray(terms),'Original case and operator terms required');
  const decision=evaluate(op,now); // original buyer→qualified-prime engine, not a reimplementation
  const chosenPrime=txt(terms.primeName)||decision.selectedPrime||'';
  const prime=decision.partners.find(p=>p.name===chosenPrime)||null;
  const source=op.buyer;
  const owner=txt(op.owner);
  requireTrue(txt(terms.packetRef).length>0&&txt(terms.packetRef).length<=100,'Unique packetRef required');
  requireTrue(!terms.buyerName||terms.buyerName===source.name,'Terms buyer must match original buyer');
  requireTrue(!terms.opportunityId||terms.opportunityId===source.opportunityId,'Terms opportunityId must match original');
  requireTrue(!terms.revision||terms.revision===source.revision,'Terms revision must match original');
  requireTrue(!terms.relationshipOwner||terms.relationshipOwner===owner,'Terms owner must match original case owner');
  requireTrue(!chosenPrime||prime,'Chosen prime is not present in original evaluated partners');
  const scope=max(terms.scope||op.workshare?.summary,4000,'scope');
  const exclusions=tidy(terms.exclusions);
  requireTrue(exclusions.length<=20,'Max 20 exclusions');
  const delivery=txt(terms.deliveryWindow)||'To be agreed';
  const deliveryOwner=txt(terms.deliveryOwner)||'To be confirmed';
  const acceptanceOwner=txt(terms.acceptanceOwner)||'Prime/customer to designate';
  const acceptanceWindow=terms.acceptanceWindowDays;
  requireTrue(acceptanceWindow===undefined || (Number.isInteger(acceptanceWindow)&&acceptanceWindow>=1&&acceptanceWindow<=90),'acceptanceWindowDays must be integer 1..90');
  const milestones=decision.workshare.milestones.map((m,i)=>({
    index:i+1, deliverable:max(m.deliverable,2000,'milestone deliverable'),
    acceptance:max(m.acceptance,3000,'milestone acceptance'),
    owner:acceptanceOwner, due:'Schedule after written work authorization',
    accepted:false, evidence:''
  }));
  requireTrue(milestones.length>0&&milestones.length<=30,'Original case needs 1..30 accepted milestone specifications');
  requireTrue(milestones.every(m=>m.deliverable&&m.acceptance),'Every milestone needs an original deliverable and acceptance criterion');
  const fee=decision.workshare.feeApproved&&usd(decision.workshare.feeUsd)?decision.workshare.feeUsd:null;
  const approvalUrl=decision.workshare.feeApproved?op.workshare?.approvalReceiptUrl||op.workshare?.approvalReceipt||'':null;
  const explicitFee=terms.priceUsd;
  if(explicitFee!==undefined&&explicitFee!==null){requireTrue(usd(explicitFee),'terms.priceUsd must be positive exact USD cents');requireTrue(fee!==null&&Math.round(fee*100)===Math.round(explicitFee*100),'Terms price cannot differ from original approved proposal fee');}
  const allocation=terms.milestonePercentages;
  if(allocation!==undefined){requireTrue(Array.isArray(allocation)&&allocation.length===milestones.length,'Milestone allocation must cover every original milestone');requireTrue(allocation.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=100),'Each milestone share must be whole percent');requireTrue(allocation.reduce((s,n)=>s+n,0)===100,'Milestone allocations must total 100%');}
  const canShare=decision.readyForOwnerApproach && !!prime?.eligibleToConsider && !!txt(terms.primeLegalName) && !!txt(terms.supplierLegalName) && !!txt(terms.deliveryOwner) && !!scope && exclusions.length>0 && fee!==null;
  // This is an operator's source-bound proposal preparation state, never contract acceptance, customer contact, invoice or payment.
  const status=canShare?'READY_FOR_HUMAN_FINAL_REVIEW':'INTERNAL_SCOPE_DRAFT';
  const watch=[...decision.blockers];
  if(!txt(terms.primeLegalName))watch.push('PRIME_LEGAL_ENTITY_NOT_CONFIRMED');
  if(!txt(terms.supplierLegalName))watch.push('SUPPLIER_LEGAL_ENTITY_NOT_CONFIRMED');
  if(!txt(terms.deliveryOwner))watch.push('DELIVERY_OWNER_NOT_NAMED');
  if(!exclusions.length)watch.push('EXCLUSIONS_NOT_SCOPED');
  const mandatory=op.requirements.filter(r=>r.mandatory===true).map(r=>{
    const e=(prime?op.partners.find(p=>p.name===prime.name)?.evidence:[])?.find(i=>i.requirementId===r.id);
    return {id:txt(r.id),description:txt(r.description),documented:!!(prime?.eligibleToConsider&&e?.status==='DOCUMENTED'&&https(e.sourceUrl)),sourceUrl:https(e?.sourceUrl)?e.sourceUrl:null};
  });
  const currency='USD';
  return {
    schema:'tjl.prime-workshare-offer.v1', packetRef:txt(terms.packetRef), generatedAt:now.toISOString(), status,
    buyer:{name:source.name,opportunityId:source.opportunityId,revision:source.revision,sourceUrl:source.sourceUrl,
      deadline:decision.buyer.deadlineText,deadlineIso:decision.buyer.deadlineIso,status:source.status,sourceReviewed:decision.sourceReview},
    prime:{name:chosenPrime||'UNASSIGNED',legalName:txt(terms.primeLegalName)||'NOT PROVIDED',documentedMandatory:prime?.documented||0,requiredMandatory:prime?.required||mandatory.length,qualifyingEvidencePresent:!!prime?.eligibleToConsider},
    supplier:{legalName:txt(terms.supplierLegalName)||'NOT PROVIDED',relationshipOwner:owner,deliveryOwner},
    scope,exclusions,requirements:mandatory,milestones,
    commercial:{priceUsd:fee,priceLabel:dollars(fee),currency,feeStatus:decision.workshare.feeStatus,
      originalApprovalReceipt:https(approvalUrl)?approvalUrl:null,
      margin:decision.workshare.margin, milestonePercentages:allocation||null,
      paymentTerms:txt(terms.paymentTerms)||'To be negotiated after acceptance',
      acceptanceWindowDays:acceptanceWindow??null,deliveryWindow:delivery},
    sourceGate:{decisionReadyForOwnerApproach:decision.readyForOwnerApproach,deadlineState:decision.deadlineState,stage:decision.stage,watch},
    boundaries:{proposalSent:false,contractExecuted:false,invoiceIssued:false,cashReceived:false,paidRequestTriggered:false}
  };
}

const note='Review source terms, legal authority and commercial economics before using this packet externally. No buyer acceptance, contract, invoice, contact or payment is recorded by its generation.';
export function markdown(p){const lines=[
  `# ${md(p.packetRef)} | Specialist engineering workshare`, '',
  `**${md(p.status.replaceAll('_',' '))}** · generated ${md(p.generatedAt)}`,'',
  `**Buyer:** ${md(p.buyer.name)} · ${md(p.buyer.opportunityId)} (${md(p.buyer.revision)})`,
  `**Original issuer:** ${p.buyer.sourceUrl}`,
  `**Original deadline:** ${md(p.buyer.deadline)} · status: ${md(p.sourceGate.deadlineState)}`,
  `**Proposed prime:** ${md(p.prime.name)} (${md(p.prime.legalName)})`,
  `**Specialist provider:** ${md(p.supplier.legalName)} · delivery owner: ${md(p.supplier.deliveryOwner)}`,'',
  '## 1. Deliverable scope','',md(p.scope),'',
  '## 2. Explicit exclusions','',...(p.exclusions.length?p.exclusions.map(x=>`- ${md(x)}`):['- NOT YET DEFINED']),'',
  '## 3. Buyer mandatory requirements and prime evidence','',
  '| Requirement | Prime evidence | Original reference |','| --- | --- | --- |',
  ...p.requirements.map(r=>`| ${md(r.id+' · '+r.description)} | ${r.documented?'Documented in submitted record':'Pending'} | ${r.sourceUrl||'Not supplied'} |`),'',
  '## 4. Work and acceptance milestones','',
  ...p.milestones.flatMap(m=>[`### ${m.index}. ${md(m.deliverable)}`,'',`Acceptance: ${md(m.acceptance)}`,'',`Reviewer: ${md(m.owner)}. Evidence and signature: ____________________`,'']),
  '## 5. Commercial terms','',
  `Proposed fee: **${md(p.commercial.priceLabel)}**. Fee state: ${md(p.commercial.feeStatus)}.`,
  `Proposed delivery window: ${md(p.commercial.deliveryWindow)}. Acceptance review days: ${p.commercial.acceptanceWindowDays??'To be agreed'}.`,
  `Payment structure: ${md(p.commercial.paymentTerms)}`,'',
  ...(p.commercial.milestonePercentages?[`Milestone allocations: ${p.commercial.milestonePercentages.join('%, ')}% of owner-approved fee.`,'']:[]),
  '## 6. Operator handoff','',
  `Current decision: ${md(p.status)}; original case stage: ${md(p.sourceGate.stage)}.`,
  ...(p.sourceGate.watch.length?p.sourceGate.watch.map(s=>`- ${md(s)}`):['- No original evaluator blockers recorded.']),'',
  `**Important:** ${note}`,'',
  '## 7. Written approvals (unexecuted)','',
  'Prime authorized reviewer: ____________________  Date: __________',
  'Specialist authorized reviewer: ____________________  Date: __________',
  'Agreed SOW / PO reference after separate acceptance: ____________________',''
];return lines.join('\n');}
export function html(p){const rows=p.requirements.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.description)}</td><td>${r.documented?'Documented':'Pending'}</td><td>${r.sourceUrl?`<a href="${esc(r.sourceUrl)}" rel="noopener noreferrer">Source</a>`:'Unprovided'}</td></tr>`).join('');const milestones=p.milestones.map(m=>`<article class="milestone"><div class="count">${m.index.toString().padStart(2,'0')}</div><div><h3>${esc(m.deliverable)}</h3><p>${esc(m.acceptance)}</p><div class="small">Acceptance reviewer: ${esc(m.owner)} · evidence/signoff: __________________</div></div></article>`).join('');const watch=p.sourceGate.watch.length?p.sourceGate.watch.map(x=>`<li>${esc(x)}</li>`).join(''):'<li>No blocking items in the original evaluator.</li>';return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.packetRef)} · Workshare</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#162038;background:#f2f5fb}*{box-sizing:border-box}body{margin:0}a{color:#2557a7}header{background:#0c1830;color:#fff;padding:48px max(24px,calc((100vw - 1000px)/2)) 40px}header h1{font-size:clamp(30px,5vw,52px);max-width:750px;letter-spacing:-.05em;margin:18px 0}header p{color:#becde7;max-width:730px}header .tag{display:inline-block;border:1px solid #6d87ae;border-radius:20px;padding:6px 12px;letter-spacing:.07em;font-size:11px;font-weight:700}main{max-width:1048px;padding:28px 24px 70px;margin:auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.panel{background:#fff;border:1px solid #dbe2ef;border-radius:14px;padding:24px;margin-bottom:18px;box-shadow:0 2px 14px #2133530c}.panel h2{font-size:19px;margin:0 0 19px;letter-spacing:-.02em}.micro{text-transform:uppercase;font-size:11px;font-weight:800;letter-spacing:.11em;color:#55708d}.value{font-size:20px;font-weight:700;overflow-wrap:anywhere}.sub{font-size:12px;color:#61718a;margin-top:8px;overflow-wrap:anywhere}.milestone{display:flex;gap:18px;border-top:1px solid #e5eaf3;padding:18px 0}.milestone h3{font-size:17px;margin:0 0 8px}.milestone p{margin:0 0 8px;line-height:1.6}.count{color:#365e9e;font-size:26px;font-weight:800}.small{font-size:12px;color:#697b95}.pill{display:inline-block;background:#e8effa;border-radius:50px;padding:8px 13px;font-size:12px;font-weight:700;color:#254572}.prose{white-space:pre-wrap;line-height:1.7}.two{display:grid;grid-template-columns:2fr 1fr;gap:18px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid #e2e8f2;vertical-align:top;overflow-wrap:anywhere}th{color:#526780}ul{padding-left:22px;line-height:1.7}footer{color:#667993;font-size:12px;padding:8px}button{border:none;background:#bed4fe;color:#0c1830;border-radius:6px;padding:9px 15px;cursor:pointer}button:focus-visible{outline:3px solid #e8b256}@media(max-width:720px){.grid,.two{grid-template-columns:1fr}header{padding:30px 24px}}@media print{header{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{background:white}.panel{box-shadow:none;break-inside:avoid}main{padding:15px}button{display:none}}
</style></head><body><header><span class="tag">SPECIALIST WORKSHARE • ${esc(p.status)}</span><h1>${esc(p.buyer.name)}</h1><p>${esc(p.packetRef)} · ${esc(p.buyer.opportunityId)} · version ${esc(p.buyer.revision)}</p><button onclick="print()">Print / Save PDF</button></header><main><div class="grid"><section class="panel"><div class="micro">Prime</div><div class="value">${esc(p.prime.name)}</div><p class="sub">${esc(p.prime.legalName)}</p></section><section class="panel"><div class="micro">Delivery owner</div><div class="value">${esc(p.supplier.deliveryOwner)}</div><p class="sub">${esc(p.supplier.legalName)}</p></section><section class="panel"><div class="micro">Owner-approved proposal fee</div><div class="value">${esc(p.commercial.priceLabel)}</div><p class="sub">${esc(p.commercial.feeStatus)}</p></section></div><section class="panel"><h2>01 · The engagement</h2><p class="prose">${esc(p.scope)}</p><div class="micro">Not included</div><ul>${p.exclusions.length?p.exclusions.map(x=>`<li>${esc(x)}</li>`).join(''):'<li>Exclusions awaiting operator definition</li>'}</ul></section><section class="panel"><h2>02 · Written deliverables &amp; acceptance</h2>${milestones}<p class="small">Acceptance window: ${p.commercial.acceptanceWindowDays??'to be agreed'} days. Delivery: ${esc(p.commercial.deliveryWindow)}.</p></section><section class="panel"><h2>03 · Prime qualification against buyer rules</h2><p><span class="pill">${p.prime.documentedMandatory} / ${p.prime.requiredMandatory} mandatory evidence items</span></p><table><thead><tr><th>ID</th><th>Buyer requirement</th><th>Evidence</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table><p class="small">Issuer: <a href="${esc(p.buyer.sourceUrl)}" rel="noopener noreferrer">Original buyer posting</a>. Exact deadline: ${esc(p.buyer.deadline)}.</p></section><div class="two"><section class="panel"><h2>04 · Commercial handoff</h2><p><strong>Delivery:</strong> ${esc(p.commercial.deliveryWindow)}</p><p><strong>Payment terms:</strong> ${esc(p.commercial.paymentTerms)}</p><p><strong>Price state:</strong> ${esc(p.commercial.feeStatus)}. No invoice or signed agreement is created.</p><p>Prime authorized reviewer: ____________________</p><p>Specialist authorized reviewer: ____________________</p><p class="small">Generated ${esc(p.generatedAt)}</p></section><section class="panel"><h2>05 · Operator review</h2><p class="pill">${esc(p.status.replaceAll('_',' '))}</p><ul>${watch}</ul></section></div><footer>${esc(note)}</footer></main></body></html>`;}
export function acceptanceCsv(p){return ['milestone,deliverable,acceptance,reviewer,evidence_reference,accepted_at,acceptance_status',...p.milestones.map(m=>[m.index,m.deliverable,m.acceptance,m.owner,'','','NOT_RECORDED'].map(csv).join(','))].join('\n')+'\n';}

export async function main(argv=process.argv.slice(2)){
  const a=args(argv);const [{raw:sourceRaw,value:data},{raw:termsRaw,value:terms}]=await Promise.all([load(a['--opportunities']),load(a['--terms'])]);
  requireTrue(Array.isArray(data.opportunities),'Expected original opportunities[] JSON');
  const matches=data.opportunities.filter(o=>o?.buyer?.opportunityId===a['--id']);
  requireTrue(matches.length===1,'--id must identify exactly one original buyer/revision case; found '+matches.length);
  const now=a['--at']?new Date(a['--at']):new Date();requireTrue(Number.isFinite(now.getTime()),'Invalid --at timestamp');
  const packet=composeOffer(matches[0],terms,now);
  const manifest={schema:'tjl.prime-workshare-manifest.v1',sourceInputSha256:sha(sourceRaw),termsInputSha256:sha(termsRaw),generatedAt:packet.generatedAt,sourceKey:packet.buyer.opportunityId,packetRef:packet.packetRef,output:packet.status};
  const dir=path.resolve(a['--out']);await mkdir(dir,{mode:0o700});
  await Promise.all([['offer.md',markdown(packet)],['offer.html',html(packet)],['acceptance.csv',acceptanceCsv(packet)],['offer.json',JSON.stringify(packet,null,2)+'\n'],['manifest.json',JSON.stringify(manifest,null,2)+'\n']].map(async ([name,s])=>writeFile(path.join(dir,name),s,{flag:'wx',mode:0o600})));
  process.stdout.write(JSON.stringify({out:dir,status:packet.status,files:['offer.md','offer.html','acceptance.csv','offer.json','manifest.json'],blockers:packet.sourceGate.watch.length})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Offer studio: '+e.message);process.exitCode=1;});
