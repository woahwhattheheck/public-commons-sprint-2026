import {validateCatalog,auditUtcDay} from './catalog.mjs';
import {normalizeRequest,screenAuditedVenues,planFromScreening} from './engine.mjs';

export const accessLabels=Object.freeze({step_free:'Step-free entry',low_sensory:'Low-sensory setting',accessible_toilet:'Accessible toilet'});
export const MAX_IMPORT_BYTES=524288;
export const SAVED_SCHEMA='accesslens-workspace/v1';

export function parseLocalJSON(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_IMPORT_BYTES) throw new Error('Choose a JSON file smaller than 512 KiB.');
  try{return JSON.parse(text);}catch{throw new Error('The file is not valid JSON. Your current catalog is unchanged.');}
}

export function reviewCatalog(value,{defaultKind='operator'}={}) {
  const rows=Array.isArray(value)?value:value?.venues;
  if(!Array.isArray(rows)||rows.length<1||rows.length>80) throw new Error('A catalog needs 1–80 venue records in an array or a venues field.');
  const kind=Array.isArray(value)?defaultKind:value.kind??defaultKind;
  if(!['operator','fixture'].includes(kind)) throw new Error('Catalog kind must be operator or fixture.');
  const label=Array.isArray(value)?'Imported venue catalog':value.label??'Imported venue catalog';
  if(typeof label!=='string'||!label.trim()||label.length>100) throw new Error('Catalog label must be 1–100 characters.');
  const issues=[],unresolved=[],venues=[],ids=new Set(),placeIds=new Set();
  rows.forEach((row,index)=>{
    try {
      const hasId=typeof row?.qloo_id==='string'&&row.qloo_id.trim();
      const venue=validateCatalog([{...row,qloo_id:hasId?row.qloo_id:'unresolved-review-only'}])[0];
      if(ids.has(venue.id)) throw new Error('duplicate operator venue ID');
      ids.add(venue.id);
      if(hasId&&placeIds.has(venue.qloo_id)) throw new Error('duplicate Qloo place ID');
      if(hasId) {placeIds.add(venue.qloo_id);venues.push(venue);}
      else unresolved.push({index,name:venue.name,city:venue.city,id:venue.id});
    } catch(error) {issues.push({index,message:error.message.replace(/^venue 0 /,'')});}
  });
  return {kind,label:label.trim(),venues,issues,unresolved,rowCount:rows.length,canApply:issues.length===0&&unresolved.length===0,
    cities:[...new Set(venues.map(v=>v.city))].sort(),
    unknownFacts:venues.reduce((n,v)=>n+['capacity','cost_usd',...Object.keys(accessLabels)].filter(k=>v[k]===null).length,0)};
}

export function catalogDocument(venues,{label='Venue catalog',kind='operator'}={}) {
  return {schema:'accesslens-catalog/v1',label,kind,venues:validateCatalog(venues)};
}

export function validateAffinity(value,{mode,artist}={}) {
  if(!value||typeof value!=='object'||!['fixture','live'].includes(mode)) throw new Error('Affinity mode is unavailable.');
  if(value.artistQuery!==artist) throw new Error('Artist changed while the provider was responding.');
  const affinity=value.affinity;
  if(typeof affinity?.artist?.id!=='string'||!affinity.artist.id||affinity.artist.id.length>180||typeof affinity.artist.name!=='string'||affinity.artist.name.length>180) throw new Error('The artist identity is incomplete.');
  if(!Array.isArray(affinity.rankedPlaceIds)||affinity.rankedPlaceIds.length>50000||affinity.rankedPlaceIds.some(x=>typeof x!=='string'||!x||x.length>180)) throw new Error('The place ranking is invalid.');
  if(value.mode!==mode||value.providerEvidence!==(mode==='live'?'LIVE_QLOO_RESPONSE':'SYNTHETIC_OFFLINE_FIXTURE')) throw new Error('Provider mode changed. Reload before planning.');
  const capture=value.providerCapture;
  if(mode==='live'&&(!capture||!Number.isFinite(Date.parse(capture.capturedAtUTC))||!Number.isFinite(capture.ageMs)||capture.ageMs<0||!Number.isSafeInteger(capture.reuseWindowMs)||capture.reuseWindowMs<0||capture.reuseWindowMs>300000)) throw new Error('The provider capture has no usable freshness information.');
  return value;
}

export function describeReason(code) {
  const labels={outside_requested_city:'Outside the selected city',audit_dated_in_future:'Observation date is in the future',audit_older_than_policy_window:'Venue information needs refreshing',insufficient_audited_capacity:'Group exceeds the recorded capacity',above_person_budget:'Above the per-person budget',capacity_unknown:'Capacity is not recorded',price_unknown:'Price is not recorded',absent_from_qloo_affinity_response:'Not in this artist’s returned Qloo places',excluded_by_group:'Excluded from this plan'};
  if(labels[code])return labels[code];
  for(const [key,label] of Object.entries(accessLabels)) {
    if(code==='fails_'+key)return label+' is recorded as unavailable';
    if(code==='unknown_'+key)return label+' is not recorded';
  }
  return code;
}

function option({venue,affinityRank}) {
  return {id:venue.id,qlooPlaceId:venue.qloo_id,name:venue.name,city:venue.city,capacity:venue.capacity,
    pricePerPersonUSD:venue.cost_usd,affinityRank,access:Object.fromEntries(Object.keys(accessLabels).map(k=>[k,venue[k]])),
    source:venue.audit_source,observedDate:venue.audit_date,recordKind:venue.record_kind??'operator_audit',sourceURL:venue.source_url??null};
}

export function planWorkspace(catalog,request,affinity,{mode,auditAsOfUTC,maxAuditAgeDays=180}={}) {
  const screening=screenAuditedVenues(catalog,request,affinity,{mode,auditAsOfUTC,maxAuditAgeDays});
  const plan=planFromScreening(screening);
  const options=screening.screened.filter(x=>!x.reasons.length).sort((a,b)=>a.affinityRank-b.affinityRank||a.venue.name.localeCompare(b.venue.name)).map(option);
  const excluded=screening.screened.filter(x=>x.reasons.length).map(x=>({...option(x),reasons:x.reasons}));
  const adjustments=[],seen=new Set();
  for(const item of screening.screened) {
    if(!item.reasons.length||item.reasons.some(r=>!['above_person_budget','insufficient_audited_capacity','outside_requested_city'].includes(r)))continue;
    const changes={};
    if(item.reasons.includes('above_person_budget')) {
      if(Math.ceil(item.venue.cost_usd)>20000)continue;
      changes.budgetUSD=Math.ceil(item.venue.cost_usd);
    }
    if(item.reasons.includes('insufficient_audited_capacity'))changes.groupSize=item.venue.capacity;
    if(item.reasons.includes('outside_requested_city'))changes.city=item.venue.city;
    const key=JSON.stringify(changes);
    if(seen.has(key))continue;
    seen.add(key);
    const parts=[];
    if(changes.budgetUSD!==undefined)parts.push(`budget $${changes.budgetUSD} per person`);
    if(changes.groupSize!==undefined)parts.push(`group of ${changes.groupSize}`);
    if(changes.city!==undefined)parts.push(`city ${changes.city}`);
    adjustments.push({venueId:item.venue.id,venueName:item.venue.name,changes,label:parts.join(' · ')});
  }
  return {...plan,options,excluded,adjustments,
    affinityIntersectionCount:screening.screened.filter(x=>x.affinityRank!==null).length,
    returnedPlaceCount:new Set(affinity.rankedPlaceIds).size};
}

export function savePlan({name,mode,catalog,catalogLabel,request,provider,plan,selectedVenueId,compareVenueIds=[]},now=new Date().toISOString()) {
  if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('Give this plan a name of 1–80 characters.');
  if(!plan?.options?.some(v=>v.id===selectedVenueId))throw new Error('Choose a current matching venue before saving.');
  const normalized=normalizeRequest(request), venues=validateCatalog(catalog);
  validateAffinity(provider,{mode,artist:normalized.artist});
  const record={schema:SAVED_SCHEMA,id:globalThis.crypto.randomUUID(),name:name.trim(),savedAtUTC:now,mode,
    catalogLabel:typeof catalogLabel==='string'?catalogLabel.slice(0,100):'Venue catalog',catalog:venues,request:normalized,
    provider:{mode,artistQuery:normalized.artist,providerEvidence:provider.providerEvidence,affinity:{artist:{...provider.affinity.artist},rankedPlaceIds:[...provider.affinity.rankedPlaceIds]},providerCapture:provider.providerCapture??null},
    selectedVenueId,compareVenueIds:[...new Set(compareVenueIds)].filter(id=>plan.options.some(v=>v.id===id)).slice(0,3),
    snapshot:{operatorAuditPolicy:{...plan.operatorAuditPolicy},selectedVenue:{...plan.options.find(v=>v.id===selectedVenueId)},status:plan.status}};
  if(new TextEncoder().encode(JSON.stringify(record,null,2)+'\n').length>MAX_IMPORT_BYTES)throw new Error('This plan exceeds the local save limit. Reduce the catalog before saving.');
  return record;
}

export function readSavedPlan(value) {
  if(!value||value.schema!==SAVED_SCHEMA||!['fixture','live'].includes(value.mode)||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||!Number.isFinite(Date.parse(value.savedAtUTC)))throw new Error('This is not a valid AccessLens saved plan.');
  const catalog=validateCatalog(value.catalog),request=normalizeRequest(value.request);
  const provider=validateAffinity(value.provider,{mode:value.mode,artist:request.artist});
  const policy=value.snapshot?.operatorAuditPolicy;
  auditUtcDay(policy?.asOfUTC);
  const replay=planWorkspace(catalog,request,provider.affinity,{mode:value.mode,auditAsOfUTC:policy.asOfUTC,maxAuditAgeDays:policy.maxAgeDays});
  if(!replay.options.some(v=>v.id===value.selectedVenueId))throw new Error('The saved selection does not satisfy its recorded constraints.');
  const compareVenueIds=Array.isArray(value.compareVenueIds)?value.compareVenueIds.filter(id=>replay.options.some(v=>v.id===id)).slice(0,3):[];
  return {...value,catalog,request,provider,compareVenueIds,catalogLabel:typeof value.catalogLabel==='string'?value.catalogLabel.slice(0,100):'Saved venue catalog',
    snapshot:{operatorAuditPolicy:replay.operatorAuditPolicy,selectedVenue:replay.options.find(v=>v.id===value.selectedVenueId),status:replay.status}};
}
