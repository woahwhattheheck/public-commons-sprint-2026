const ISSUER = 'https://www.opentech.fund/news/open-technology-fund-requests-proposals-for-the-rapid-response-fund/';
const DEADLINE = '2026-11-23 23:59 EST';
const SERVICE_LABELS = Object.freeze({
  'organizational-security':'Organizational Security & Digital Security Support',
  'digital-attacks':'Digital Attacks Response & Forensic Analysis',
  'web-hosting':'Web Hosting',
  'censorship-response':'Censorship Events and Network Shutdowns Response',
  'localization':'Localization',
});
const REQUIRED_SUPPORT = Object.freeze({
  assessment:'Case assessment and signed-work-order request before work',
  coordination:'Communication with clients, OTF and partner vendors',
  outreach:'Relevant community outreach and coordination',
  reporting:'End-of-engagement reports tied to invoicing',
});
const REQUIRED_QUALIFICATIONS = Object.freeze({
  community:'Community / prior work / geographies',
  outreach:'Promotion and outreach strategy',
  capacity:'Cases per month, case hours and actual staffing',
  response:'Service-specific methodology, hours, channels and triage',
  governance:'Governance, privacy and sensitive-data handling',
});
const REQUIRED_ATTESTATIONS = Object.freeze({
  noSurveillanceBusiness:'Applicant/affiliates are not engaged in surveillance-technology trade',
  noExclusion:'Applicant/affiliates not sanctioned, debarred or excluded',
  remitFits:'Proposed work fits OTF remit 2(b)',
  independentAudits:'No relationship compromising independent impartial audits',
  acceptsAppendixA:'Authorized signatory accepts original RFP Appendix A provisions',
});
const asString = value => typeof value === 'string' ? value.trim() : '';
const asArray = value => Array.isArray(value) ? value : [];
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const safe = value => asString(value).replace(/\\/g,'\\\\').replace(/([`*_[\]<>])/g,'\\$1').replace(/[\u0000-\u001f]/g,' ').replace(/\|/g,'\\|');
const section = (label, value) => `**${label}:** ${value ? safe(value) : 'NOT PROVIDED'}\n`;
const privateCustody = value => /\binternal\s*:|(?:notion-file-block|file-upload):\/\/|https?:\/\/(?:[a-z0-9-]+\.)*(?:slack\.com|chatgpt\.com|notion\.com|notion\.so|mail\.google\.com)(?:[/:?#]|$)/i.test(value);
const money = cents => Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? `$${(cents/100).toFixed(2)}` : 'NOT PROVIDED';
export function check(doc){
const needs = [];
const warnings = [];
function required(path,value) {if(!asString(value)) needs.push(path); return asString(value);}
function evidence(path,value) {
  const str = required(path,value);
  if (str && !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(str) && !/^internal:[^\s].{2,}$/.test(str)) {
    warnings.push(`${path}: evidence must be an https URL or an internal:<stable-id> custody reference`);
  }
  return str;
}
  const org=obj(doc.applicant); const contact=obj(doc.contact); const qualifications=obj(doc.qualifications);
  const serviceList=asArray(doc.services); const labor=asArray(doc.laborRates); const members=asArray(doc.team);
  const att=obj(doc.attestations); const support=obj(doc.supportServices);
  required('applicant.name',org.name); required('applicant.description',org.description);
  required('contact.email',contact.email); required('contact.replyOwner',contact.replyOwner);
  if(contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) warnings.push('contact.email: invalid address');
  if(members.length<1) needs.push('team: at least one actual assigned person/CV');
  members.forEach((m,i)=>{required(`team[${i}].name`,obj(m).name);required(`team[${i}].role`,obj(m).role);required(`team[${i}].bio`,obj(m).bio);evidence(`team[${i}].cvEvidence`,obj(m).cvEvidence);});
  if(serviceList.length<1) needs.push('services: at least one named primary service');
  serviceList.forEach((s,i)=>{
    const path=`services[${i}]`;
    if(!SERVICE_LABELS[asString(obj(s).category)]) needs.push(`${path}.category: one of ${Object.keys(SERVICE_LABELS).join(', ')}`);
    required(`${path}.offering`,obj(s).offering);required(`${path}.method`,obj(s).method);
  });
  if(labor.length<1||labor.length>5) needs.push('laborRates: 1 to 5 distinct real categories');
  const titles=new Set();
  labor.forEach((r,i)=>{
    const title=required(`laborRates[${i}].title`,obj(r).title).toLowerCase();
    if(titles.has(title)) warnings.push(`laborRates[${i}].title: duplicate category`);
    titles.add(title);
    if(!Number.isSafeInteger(obj(r).loadedHourlyCents)||r.loadedHourlyCents<=0||r.loadedHourlyCents>100000000) needs.push(`laborRates[${i}].loadedHourlyCents: positive safe integer USD cents, maximum 100000000`);
    if('commercialHourlyCents' in obj(r) && (!Number.isSafeInteger(r.commercialHourlyCents)||r.commercialHourlyCents<=0||r.commercialHourlyCents>100000000)) warnings.push(`laborRates[${i}].commercialHourlyCents: must be positive integer if supplied`);
  });
  for(const k of Object.keys(REQUIRED_SUPPORT)) required(`supportServices.${k}`,support[k]);
  for(const k of Object.keys(REQUIRED_QUALIFICATIONS)) required(`qualifications.${k}`,qualifications[k]);
  const examples=asArray(doc.workExamples);
  if(!examples.length) needs.push('workExamples: at least one genuine previous technical delivery');
  examples.forEach((x,i)=>{required(`workExamples[${i}].title`,obj(x).title);required(`workExamples[${i}].work`,obj(x).work);evidence(`workExamples[${i}].evidence`,obj(x).evidence);if(x && x.disclosureApproved!==true) needs.push(`workExamples[${i}].disclosureApproved: human confirmation`);});
  // "none" is an intentional answer. Empty strings are not.
  required('languagesOtherThanEnglish',doc.languagesOtherThanEnglish);
  required('otherServices',doc.otherServices);
  required('proposalDataRestrictions',doc.proposalDataRestrictions);
  required('applicant.policyContact',org.policyContact);
  required('attestations.authorizedSignatory',att.authorizedSignatory);
  for(const k of Object.keys(REQUIRED_ATTESTATIONS)) if(att[k]!==true) needs.push(`attestations.${k}: authorized human certification required`);
  if(!asString(att.appendixAReviewedFrom)) needs.push('attestations.appendixAReviewedFrom: actual 2026 RFP Appendix A source');
  if(doc.caseBudget||doc.caseAuthorization) warnings.push('Do not include per-case budget/approval in vendor proposal. Case approval is subsequent, in writing, by OTF Program Manager.');
  return {needs:[...new Set(needs)],warnings};
}
export function render(doc,quality,{audience='internal'}={}){
  if(!['internal','submission'].includes(audience))throw Error('Unknown proposal audience');
  if(audience==='submission'&&(quality.needs.length||quality.warnings.length))throw Error('Complete required proposal fields before rendering submission edition');
  const a=obj(doc.applicant),c=obj(doc.contact),q=obj(doc.qualifications),s=obj(doc.supportServices),att=obj(doc.attestations);
  const evidenceFor=(value,originalKey,publicKey,label)=>{
    const item=obj(value);
    const selected=audience==='submission'?(asString(item[publicKey])||asString(item[originalKey])):asString(item[originalKey]);
    if(audience==='submission'&&(!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(selected)||privateCustody(selected))){
      throw Error(label+': provide an outward HTTPS evidence reference; retain private custody in '+originalKey);
    }
    return safe(selected);
  };
  const lines=[
    '# OTF Rapid Response Fund 2026 | Vendor submission working draft',
    '',
    `> Internal review draft, NOT SUBMITTED. Status: **${quality.needs.length||quality.warnings.length?'INCOMPLETE / HUMAN REVIEW':'COMPLETE CONTENT / HUMAN LEGAL REVIEW'}**.`,
    `> Issuer: ${ISSUER} | Submission deadline: ${DEADLINE}.`,
    '> T&M contract up to $150,000 initial ceiling; neither an award nor case volume nor cash is guaranteed. No cases may start before OTF Program Manager written approval.',
    '',
    '## 1. Applicant, technical expertise and personnel',
    section('Applicant',a.name),section('Organization or individual background',a.description),section('Reply owner',c.replyOwner),section('Contact',c.email),
    section('Policy / contracting point of contact',a.policyContact),
    ...asArray(doc.team).map((m,i)=>`- ${i+1}. **${safe(obj(m).name)}**, ${safe(obj(m).role)}: ${safe(obj(m).bio)} (CV evidence: ${evidenceFor(m,'cvEvidence','cvPublicEvidence',`team[${i}].cvPublicEvidence`)})`),
    '',
    '## 2. Primary requested services and loaded hourly rates',
    ...asArray(doc.services).map((x,i)=>`- ${i+1}. **${safe(SERVICE_LABELS[asString(obj(x).category)]||'INVALID CATEGORY')}**: ${safe(obj(x).offering)}. Method: ${safe(obj(x).method)}`),
    '',
    '| Labor category | Loaded USD / hour | Standard commercial USD / hour (optional) |',
    '|---|---:|---:|',
    ...asArray(doc.laborRates).map(x=>`| ${safe(obj(x).title)} | ${money(obj(x).loadedHourlyCents)} | ${'commercialHourlyCents' in obj(x)?money(obj(x).commercialHourlyCents):'Not specified'} |`),
    '',
    'Rates are inclusive of labor, fringe and indirect costs; reimbursable direct costs require separate preapproval, allowable actual cost and receipts.',
    'The completed original issuer budget workbook accompanies this proposal. Its requested ceiling is an evaluation amount; approved actual casework is billed separately.',
    '',
    '## 3. Required support services',
    ...Object.entries(REQUIRED_SUPPORT).map(([k,label])=>section(label,s[k])),
    '',
    '## 4. Relevant qualifications',
    ...Object.entries(REQUIRED_QUALIFICATIONS).map(([k,label])=>section(label,q[k])),
    '',
    '## 5. Examples of prior technical work',
    ...asArray(doc.workExamples).map((x,i)=>`- ${i+1}. **${safe(obj(x).title)}**: ${safe(obj(x).work)}. ${audience==='submission'?'Evidence':'Evidence/custody'}: ${evidenceFor(x,'evidence','publicEvidence',`workExamples[${i}].publicEvidence`)}.${audience==='internal'?` Disclosure permission: ${x.disclosureApproved===true?'confirmed':'NOT CONFIRMED'}.`:''}`),
    '',
    '## 6. Language proficiencies other than English',section('Languages (use "none" when accurate)',doc.languagesOtherThanEnglish),
    '',
    '## 7. Other relevant services',section('Other services (use "none" when accurate)',doc.otherServices),
    '',
    '## 8. Restrictions on use of data in this proposal',section('Restrictions (use "none" when accurate)',doc.proposalDataRestrictions),
    '',
    '## 9. Appendix A and eligibility certification (human owner only)',
    section('Authorized signatory',att.authorizedSignatory),
    section('Appendix A source reviewed',att.appendixAReviewedFrom),
    ...Object.entries(REQUIRED_ATTESTATIONS).map(([k,label])=>`- ${label}: **${att[k]===true?'Human attested TRUE':'NOT ATTESTED'}**`),
    '',
    '## Internal completeness review (exclude before external submission)',
    ...quality.needs.map(x=>`- MISSING: ${safe(x)}`),
    ...quality.warnings.map(x=>`- REVIEW: ${safe(x)}`),
    '',
    'No submission, customer approval, contractual award or payment is implied by generation of this draft.',
    ''
  ];
  if(audience==='submission'){
    const cut=lines.indexOf('## Internal completeness review (exclude before external submission)');
    if(cut>=0)lines.splice(cut);
    const body=lines.filter(x=>!x.startsWith('> Internal review draft'));
    body[0]='# OTF Rapid Response Fund 2026 | Vendor proposal';
    for(let i=0;i<body.length;i++){
      body[i]=body[i].replace('## 9. Appendix A and eligibility certification (human owner only)','## 9. Appendix A and eligibility certification')
        .replace(/Human attested TRUE/g,'Confirmed').replace(/Human attested/g,'Confirmed');
      if(privateCustody(body[i]))throw Error('Submission edition contains a private workspace or custody reference; select outward source text and evidence');
    }
    return body.join('\n').trimEnd()+'\n';
  }
  return lines.join('\n');
}
