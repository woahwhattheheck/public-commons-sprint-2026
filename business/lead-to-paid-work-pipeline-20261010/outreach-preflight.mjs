#!/usr/bin/env node
/**
 * Offline cross-seat outreach collision review. Input is *operator-supplied*
 * verified Gmail history plus candidate first contacts, never a live mailbox read.
 * No API calls, credentials, external contact, GitHub Actions or CI.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const must = (ok,message) => {if(!ok) throw new Error(message);};
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const canonical = (s) => {must(nonEmpty(s),'Missing stable buyer/solicitation/prime identity');return s.trim().toLowerCase().replace(/\s+/g,' ');};
const date = (s, label) => {
  must(typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(s),`${label}: ISO timestamp with explicit offset required`);
  const d=new Date(s);must(!Number.isNaN(d.getTime()),`${label}: invalid timestamp`);return d;
};
export function mailbox(s){
  must(nonEmpty(s),'Mailbox required');
  const raw = s.trim().match(/^(?:[^<>\r\n]{1,200}\s+)?<([^<>\s]+)>$/)?.[1] ?? s.trim();
  must(/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(raw),`Invalid mailbox: ${s}`);
  return raw.toLowerCase();
}
function recipients(x){
  must(Array.isArray(x) && x.length>0 && x.length<=20,'to must be 1..20 explicit mailbox strings');
  const vals=x.map(mailbox);
  must(new Set(vals).size===vals.length,'Duplicate recipient within message');
  return vals;
}
const key = (x,recipient) => [canonical(x.buyerId),canonical(x.solicitationId),recipient].join('::');
const primeKey = x => nonEmpty(x.primeId) ? [canonical(x.buyerId),canonical(x.solicitationId),'prime:'+canonical(x.primeId)].join('::') : null;
const match = (source,target) => source.recipientKey===target.recipientKey || (source.primeKey!==null && source.primeKey===target.primeKey);
function fingerprint(x,recipient){return {recipientKey:key(x,recipient),primeKey:primeKey(x),recipient};}
function validateCoverage(source, now, freshnessMinutes){
  const cov=source.coverage||{};
  const required = recipients(cov.requiredMailboxes || []);
  const checked = new Set(recipients(cov.checkedMailboxes||[]));
  const checkedAt=date(cov.checkedAt,'coverage.checkedAt');
  const coverageFrom=date(cov.coverageFrom,'coverage.coverageFrom');
  const omitted=required.filter(x=>!checked.has(x));
  const ageMinutes=(now.getTime()-checkedAt.getTime())/60000;
  const reasons=[];
  if(omitted.length) reasons.push('REQUIRED_MAILBOX_NOT_CHECKED');
  if(coverageFrom > checkedAt || checkedAt > now) reasons.push('INVALID_COVERAGE_INTERVAL');
  if(ageMinutes>freshnessMinutes) reasons.push('STALE_MAILBOX_SNAPSHOT');
  if(!nonEmpty(cov.source)||cov.source!=='GMAIL_SENT_SEARCH') reasons.push('GMAIL_SENT_SOURCE_NOT_RECORDED');
  return {ready:reasons.length===0,checkedAt:checkedAt.toISOString(),coverageFrom:coverageFrom.toISOString(),ageMinutes:Math.round(ageMinutes*100)/100,requiredMailboxes:required,checkedMailboxes:[...checked],reasons};
}
export function review(input, now=new Date(), freshnessMinutes=10){
  must(input && typeof input==='object'&&!Array.isArray(input),'Input must be an object');
  must(Number.isFinite(freshnessMinutes)&&freshnessMinutes>0&&freshnessMinutes<=120,'Freshness must be in (0,120] minutes');
  must(Array.isArray(input.sent)&&Array.isArray(input.intents),'sent[] and intents[] required');
  const coverage=validateCoverage(input,now,freshnessMinutes);
  const sent=[];const ids=new Set();
  for(const [i,m] of input.sent.entries()){
    must(nonEmpty(m.messageId)&&!ids.has(m.messageId),`sent[${i}]: unique provider messageId required`);
    ids.add(m.messageId);
    must(Array.isArray(m.labels)&&m.labels.includes('SENT'),`sent[${i}]: verified SENT label required (not draft)`);
    const sentAt=date(m.sentAt,`sent[${i}].sentAt`);
    must(sentAt<=now,`sent[${i}]: message dated in future`);
    const sender=mailbox(m.from);
    for(const to of recipients(m.to)) sent.push({...fingerprint(m,to),messageId:m.messageId,from:sender,sentAt:sentAt.toISOString()});
  }
  const intents=[];const intentIds=new Set();
  for(const [i,m] of input.intents.entries()){
    must(nonEmpty(m.id)&&!intentIds.has(m.id),`intents[${i}]: unique id required`);
    intentIds.add(m.id);
    must(m.kind==='FIRST_CONTACT',`intents[${i}]: only FIRST_CONTACT supported; handle replies in the original thread`);
    must(nonEmpty(m.owner),`intents[${i}]: relationship owner required`);
    for(const to of recipients(m.to)) intents.push({...fingerprint(m,to),intentId:m.id,owner:m.owner});
  }
  const evaluated=intents.map(t=>{
    const prior=sent.filter(x=>match(x,t));
    const others=intents.filter(x=>x!==t && x.intentId!==t.intentId && match(x,t));
    const reasons=[];
    if(prior.length) reasons.push('FIRST_CONTACT_ALREADY_SENT');
    if(others.length) reasons.push('MULTIPLE_PENDING_FIRST_CONTACTS');
    if(!coverage.ready) reasons.push(...coverage.reasons);
    // A PASS is a collision preflight only, NOT permission or approval to send.
    return {intentId:t.intentId,owner:t.owner,recipient:t.recipient,decision:reasons.length?'HOLD':'NO_COLLISION_OBSERVED',reasons:[...new Set(reasons)],matchingSent:[...new Map(prior.map(s=>[s.messageId,{messageId:s.messageId,sentAt:s.sentAt,from:s.from}])).values()],otherIntentIds:[...new Set(others.map(x=>x.intentId))]};
  });
  // Existing duplicate pairs are surfaced even when no new intent exists.
  const duplicates=[];
  for(let i=0;i<sent.length;i++)for(let j=i+1;j<sent.length;j++){
    if(sent[i].messageId!==sent[j].messageId && match(sent[i],sent[j])) {
      const pair=[sent[i].messageId,sent[j].messageId].sort();
      if(!duplicates.some(x=>x.messageIds[0]===pair[0]&&x.messageIds[1]===pair[1])) duplicates.push({messageIds:pair,recipient:sent[i].recipient,reason:'SAME_BUYER_SOLICITATION_RECIPIENT_OR_PRIME'});
    }
  }
  return {generatedAt:now.toISOString(),source:'OPERATOR_SUPPLIED_GMAIL_SENT_SNAPSHOT',coverage,summary:{sentMessages:ids.size,pendingIntents:input.intents.length,heldIntents:evaluated.filter(x=>x.decision==='HOLD').length,existingDuplicatePairs:duplicates.length},candidates:evaluated,existingDuplicatePairs:duplicates,operatorAction:'Check live SENT in every relevant mailbox immediately before one chosen send, then record provider receipt. NO_COLLISION_OBSERVED is not authorization or a distributed lock; coordinate with the relationship owner.'};
}
async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args.includes('--help')){console.log('Usage: node outreach-preflight.mjs <snapshot.json> <output.json> [--now=2026-10-11T12:00:00Z]');return;}
  must(args.length>=2,'Input snapshot and output JSON required');
  const raw=JSON.parse(await readFile(args[0],'utf8'));
  const nowArg=args.find(x=>x.startsWith('--now='));
  const now=nowArg?date(nowArg.slice(6),'--now'):new Date();
  const result=review(raw,now);
  const output=path.resolve(args[1]);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,summary:result.summary}));
}
if(process.argv[1]&&import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
