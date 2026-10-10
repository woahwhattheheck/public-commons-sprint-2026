import {fixtureInsights, validateCatalog, auditUtcDay} from './catalog.mjs';

export function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
  const artist = body.artist;
  if (typeof artist !== 'string' || artist.trim().length < 2 || artist.trim().length > 90 || /[\x00-\x1f]/.test(artist)) throw new Error('artist must be 2–90 readable characters');
  const groupSize = body.groupSize;
  if (!Number.isSafeInteger(groupSize) || groupSize < 1 || groupSize > 1000) throw new Error('group size must be 1–1000');
  const budgetUSD = body.budgetUSD;
  if (!Number.isSafeInteger(budgetUSD) || budgetUSD < 0 || budgetUSD > 20000) throw new Error('budget must be 0–20000 USD');
  const required = body.required;
  if (!Array.isArray(required) || required.length > 3 || required.some(x => !['step_free','low_sensory','accessible_toilet'].includes(x)) || new Set(required).size !== required.length) throw new Error('invalid accessibility requirements');
  return {artist:artist.trim(),groupSize,budgetUSD,required};
}

export function planAuditedVenues(rawCatalog, rawRequest, affinity,
    {mode='fixture', auditAsOfUTC=new Date().toISOString().slice(0,10), maxAuditAgeDays=180}={}) {
  const asOfDay = auditUtcDay(auditAsOfUTC);
  if (!Number.isSafeInteger(maxAuditAgeDays) || maxAuditAgeDays < 1 || maxAuditAgeDays > 365) {
    throw new Error('audit policy window must be 1–365 calendar days');
  }
  const catalog = validateCatalog(rawCatalog);
  const request = normalizeRequest(rawRequest);
  const ids = affinity?.rankedPlaceIds;
  if (!Array.isArray(ids) || ids.some(id=>typeof id!=='string')) throw new Error('missing provider-ranked place IDs');
  const ranks = new Map(ids.map((id, index) => [id,index]).filter(([id], i, entries) => entries.findIndex(x=>x[0]===id)===i));
  const screened = catalog.map(v=>{
    const reasons=[];
    const ageDays = asOfDay - auditUtcDay(v.audit_date);
    if (ageDays < 0) reasons.push('audit_dated_in_future');
    else if (ageDays > maxAuditAgeDays) reasons.push('audit_older_than_policy_window');
    if (v.capacity<request.groupSize) reasons.push('insufficient_audited_capacity');
    if (v.cost_usd>request.budgetUSD) reasons.push('above_person_budget');
    for(const key of request.required) if(!v[key]) reasons.push('fails_'+key);
    if(!ranks.has(v.qloo_id)) reasons.push('absent_from_qloo_affinity_response');
    return {venue:v, reasons, affinityRank:ranks.has(v.qloo_id)?ranks.get(v.qloo_id)+1:null};
  });
  const eligible=screened.filter(v=>v.reasons.length===0).sort((a,b)=>a.affinityRank-b.affinityRank||a.venue.name.localeCompare(b.venue.name));
  const picks=eligible.slice(0,3).map(({venue,affinityRank})=>({
    name:venue.name,city:venue.city,operatorVenueId:venue.id,qlooPlaceId:venue.qloo_id,
    affinityRank,pricePerPersonUSD:venue.cost_usd,capacity:venue.capacity,
    accessChecklist:Object.fromEntries(request.required.map(k=>[k,venue[k]])),
    accessibilitySource:venue.audit_source,accessibilityAuditDate:venue.audit_date,
    explanation:`Qloo ${mode==='live'?'live':'synthetic'} place result #${affinityRank}; accessibility constraints independently checked against operator metadata.`
  }));
  const nearMisses=screened.filter(v=>v.reasons.length).slice(0,8).map(({venue,reasons})=>({name:venue.name, reasons}));
  return {
    schema:'accesslens-plan/v1',status:picks.length?'RECOMMENDATIONS':'ABSTAIN_NO_VERIFIED_FIT',
    providerEvidence:mode==='live'?'LIVE_QLOO_RESPONSE':'SYNTHETIC_OFFLINE_FIXTURE',
    artist:request.artist,artistEntityId:affinity.artist?.id??null,
    hardRequirements:request.required,groupSize:request.groupSize,budgetUSD:request.budgetUSD,
    operatorAuditPolicy:{asOfUTC:auditAsOfUTC,maxAgeDays:maxAuditAgeDays},
    recommended:picks,shortlistCount:eligible.length,consideredCount:catalog.length,nearMisses,
    notices:[
      'Qloo supplies cultural affinity ordering, NOT accessibility, capacity, prices or route details.',
      'Operator-supplied accessibility audits are not independently verified by this application; confirm with venues before attending.',
      `Venue audit records dated in the future or older than ${maxAuditAgeDays} days as of ${auditAsOfUTC} cannot qualify.`,
      'A venue passing step-free checks does not establish step-free travel routes or transit availability.',
      ...(mode==='fixture'?['DEMONSTRATION ONLY: all venues, Qloo IDs and Qloo ranking in this response are fictional. Fixture evaluation date is pinned for reproducibility.']:[])
    ]
  };
}

export function fixturePlan(request, catalog) {
  return planAuditedVenues(catalog,request,{artist:{id:'demo-artist-id'},rankedPlaceIds:fixtureInsights},{mode:'fixture',auditAsOfUTC:'2026-10-09'});
}
