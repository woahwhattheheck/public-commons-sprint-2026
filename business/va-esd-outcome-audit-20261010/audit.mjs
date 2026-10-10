// Read-only independent-outcome/billing reconciliation for normalized contact evidence.
// Normalized feed format is an author-proposed interchange, NOT a VA-issued schema.
// No payment, procurement submission, external network calls or PII output.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const eventTypes=new Set(['ai_attempt','ai_resolved','agent_handle','escalated','human_resolved','abandoned','repeat_contact']);
const billingTypes=new Set(['ai_success','human_success','nonbillable']);
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function requireObject(o,name) {
  if(!o || typeof o!=='object' || Array.isArray(o)) throw new TypeError(name+'_OBJECT_REQUIRED');
}
function exactKeys(o,required,optional,name) {
  requireObject(o,name);
  const allowed=new Set([...required,...optional]);
  for(const key of Object.keys(o)) if(!allowed.has(key)) throw new TypeError(name+'_UNEXPECTED_FIELD_'+key);
  for(const key of required) if(!(key in o)) throw new TypeError(name+'_MISSING_'+key);
}
function token(v,name) {
  if(typeof v!=='string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(v)) throw new TypeError(name+'_OPAQUE_TOKEN_REQUIRED');
  return v;
}
function instant(v,name) {
  if(typeof v!=='string'||!iso.test(v)||!Number.isFinite(Date.parse(v))) throw new TypeError(name+'_UTC_INSTANT_REQUIRED');
  return Date.parse(v);
}
function verifyPolicy(p) {
  exactKeys(p,['vendorSources','independentSources','repeatWindowHours'],[],'POLICY');
  for(const [field,arr] of [['vendorSources',p.vendorSources],['independentSources',p.independentSources]]) {
    if(!Array.isArray(arr) || !arr.length || new Set(arr).size!==arr.length) throw new TypeError('POLICY_'+field+'_INVALID');
    arr.forEach(v=>token(v,'POLICY_SOURCE'));
  }
  if(p.vendorSources.some(v=>p.independentSources.includes(v))) throw new TypeError('POLICY_SOURCE_NOT_INDEPENDENT');
  if(!Number.isInteger(p.repeatWindowHours)||p.repeatWindowHours<1||p.repeatWindowHours>24*365) throw new TypeError('POLICY_REPEAT_WINDOW_INVALID');
  return {vendor:new Set(p.vendorSources),independent:new Set(p.independentSources),windowMs:p.repeatWindowHours*3600000};
}
function readEvidence(events, policy) {
  const byContact=new Map(), repeats=new Map(), ids=new Set();
  for(const event of events) {
    exactKeys(event,['eventId','contactId','at','type','source'],['parentContactId'],'EVENT');
    token(event.eventId,'EVENT_ID');token(event.contactId,'CONTACT_ID');token(event.source,'SOURCE');
    if(!eventTypes.has(event.type)) throw new TypeError('EVENT_TYPE_UNKNOWN');
    if(!policy.vendor.has(event.source)&&!policy.independent.has(event.source)) throw new TypeError('EVENT_SOURCE_UNATTESTED');
    if(ids.has(event.eventId)) throw new TypeError('EVENT_DUPLICATE_ID');
    ids.add(event.eventId);
    const ms=instant(event.at,'EVENT_AT');
    if(event.type==='repeat_contact') {
      token(event.parentContactId,'REPEAT_PARENT');
      if(event.parentContactId===event.contactId) throw new TypeError('REPEAT_SELF_REFERENCE');
      if(!repeats.has(event.parentContactId)) repeats.set(event.parentContactId,[]);
      repeats.get(event.parentContactId).push(ms);
    } else if('parentContactId' in event) throw new TypeError('EVENT_UNEXPECTED_PARENT');
    if(!byContact.has(event.contactId)) byContact.set(event.contactId,[]);
    byContact.get(event.contactId).push({...event,ms});
  }
  return {byContact,repeats};
}
function verifyClaim(c) {
  exactKeys(c,['contactId','billedAs','amountMinor','currency'],[],'CLAIM');
  token(c.contactId,'CLAIM_CONTACT');
  if(!billingTypes.has(c.billedAs)) throw new TypeError('CLAIM_BILLING_TYPE_UNKNOWN');
  if(c.currency!=='USD') throw new TypeError('CLAIM_CURRENCY_USD_ONLY');
  if(typeof c.amountMinor!=='string'||!/^(?:0|[1-9]\d{0,15})$/.test(c.amountMinor)) throw new TypeError('CLAIM_INTEGER_MINOR_UNITS_REQUIRED');
  return BigInt(c.amountMinor);
}
export function auditOutcomeClaims({events,claims,policy}) {
  if(!Array.isArray(events)||!Array.isArray(claims)||claims.length===0) throw new TypeError('RECORD_ARRAYS_REQUIRED');
  const p=verifyPolicy(policy), {byContact,repeats}=readEvidence(events,p);
  const counts=new Map();
  for(const c of claims) { verifyClaim(c); counts.set(c.contactId,(counts.get(c.contactId)||0)+1); }
  let billed=0n,review=0n,supported=0;
  const findings=claims.map((c,index)=>{
    const amount=BigInt(c.amountMinor);
    billed+=amount;
    const events=byContact.get(c.contactId)||[], reasons=[];
    if(counts.get(c.contactId)>1) reasons.push('DUPLICATE_CONTACT_BILLED');
    const had=(kind)=>events.some(e=>e.type===kind);
    const confirmed=(kind)=>events.filter(e=>e.type===kind&&p.independent.has(e.source));
    if(c.billedAs==='ai_success') {
      if(!events.some(e=>e.type==='ai_attempt'&&p.vendor.has(e.source))) reasons.push('AI_ATTEMPT_NOT_OBSERVED');
      const resolved=confirmed('ai_resolved');
      if(!resolved.length) reasons.push('INDEPENDENT_AI_RESOLUTION_MISSING');
      if(had('escalated')||had('agent_handle')||had('human_resolved')) reasons.push('HUMAN_INTERVENTION_OR_ESCALATION');
      if(had('abandoned')) reasons.push('ABANDONED_INTERACTION');
      const recontacts=repeats.get(c.contactId)||[];
      if(resolved.some(e=>recontacts.some(t=>t>=e.ms && t<=e.ms+p.windowMs))) reasons.push('REPEAT_WITHIN_CONFIGURED_WINDOW');
    } else if(c.billedAs==='human_success') {
      if(!had('agent_handle')) reasons.push('AGENT_HANDLING_NOT_OBSERVED');
      if(!confirmed('human_resolved').length) reasons.push('INDEPENDENT_HUMAN_RESOLUTION_MISSING');
    } else if(amount!==0n) reasons.push('NONBILLABLE_AMOUNT_NONZERO');
    const status=reasons.length?'REVIEW':'SUPPORTED';
    if(status==='REVIEW') review+=amount; else supported++;
    // Intentionally emit only source-row numbers, never contact IDs, PII or transcripts.
    return {row:index+1,status,reasons};
  });
  return {schema:'va-esd-outcome-audit.v1',summary:{
    claims:claims.length,supported,review:claims.length-supported,
    invoicedMinor:billed.toString(),requiresReviewMinor:review.toString(),currency:'USD'
  },findings};
}
async function jsonl(path) {
  const buf=await readFile(path);
  if(buf.length>268435456)throw new Error('FILE_EXCEEDS_256_MIB_PILOT_CAP');
  const lines=buf.toString('utf8').split(/\r?\n/), rows=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line.trim())continue;
    if(Buffer.byteLength(line)>16384)throw new Error('ROW_TOO_LONG_AT_'+(i+1));
    try{rows.push(JSON.parse(line));}catch{throw new Error('INVALID_JSONL_AT_'+(i+1));}
  }
  return {rows,sha256:createHash('sha256').update(buf).digest('hex')};
}
export async function runCli(argv) {
  if(argv.length!==3)throw new Error('USAGE: node audit.mjs <events.jsonl> <invoice.jsonl> <policy.json>');
  const [e,c]=await Promise.all([jsonl(argv[0]),jsonl(argv[1])]);
  const policy=JSON.parse(await readFile(argv[2],'utf8'));
  const result=auditOutcomeClaims({events:e.rows,claims:c.rows,policy});
  return {...result,inputHashes:{eventsSHA256:e.sha256,invoiceSHA256:c.sha256}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n'),
    e=>{process.stderr.write(String(e.message)+'\n');process.exitCode=1;});
}
