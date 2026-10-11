#!/usr/bin/env node
/**
 * Offline Gmail-receipt-to-next-action triage for the existing lead-to-paid workflow.
 * No mailbox access, network calls, messages sent, scheduling or credentials.
 * The operator supplies provider-read messages and explicitly maps each to caseId.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const must=(ok,m)=>{if(!ok) throw new Error(m);};
const value=x=>String(x??'').trim();
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const iso=(x,label)=>{must(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d)$/.test(x),`${label}: explicit-offset ISO timestamp required`); const d=new Date(x);must(Number.isFinite(d.getTime()),`${label}: invalid timestamp`);return d;};
const addr=s=>{const raw=value(s);const email=(raw.match(/<([^<>\s]+)>/)||[])[1]||raw;return /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(email)?email.toLowerCase():null;};
const asList=x=>Array.isArray(x)?x:[x];
const url=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!!u.hostname;}catch{return false;}};
const uniq=x=>[...new Set(x)];
const FIRST_CONTACT_FOLLOWUP_HOURS=48;
const autoSubject=/^(automatic reply|auto(?:matic)?[ -]?reply|out of office|ooo\b|away from office|vacation reply|autoreply\b)/i;
const bounceSubject=/^(delivery (status notification|failed|failure)|undeliverable|mail delivery (failed|subsystem)|returned mail|failure notice)/i;
const bounceSender=/^(?:mailer-daemon|postmaster)@/i;

function kind(m){
  const labels=m.labels||[];
  if(labels.includes('DRAFT'))return 'DRAFT';
  if(labels.includes('SENT')) return 'SENT';
  const subj=value(m.subject),from=addr(m.from??m.from_);
  if(bounceSubject.test(subj)||bounceSender.test(from||'')||/report-type\s*=\s*[\"']?delivery-status/i.test(value(m.contentType)))return 'BOUNCE';
  const autoSubmitted=value(m.autoSubmitted).split(';')[0].trim().toLowerCase();
  if(autoSubject.test(subj)||(autoSubmitted && autoSubmitted !== 'no')||/\b(automatic reply|auto-reply|out of office)\b/i.test(value(m.autoSubmitted??'')))return 'AUTO_REPLY';
  if(m.detail && m.detail !== 'FULL_HEADERS')return 'CONTENT_REQUIRED';
  return 'HUMAN_REVIEW';
}
function routedContacts(auto,mailboxes){
  // Ignore quoted originals and their address headers before looking for a referral.
  const authored=[];
  for(const line of value(auto.body||auto.snippet).split(/\r?\n/)){
    if(/^\s*(?:On\s+.+wrote:|[-_]{2,}\s*(?:Original|Forwarded) Message|Begin forwarded message:|(?:From|Sent|Date|To|Cc|Subject):)/i.test(line))break;
    if(!/^\s*>/.test(line))authored.push(line);
  }
  const route=/\b(?:please\s+(?:contact|email)|instead\s+(?:contact|email)|reach\s+out\s+to|(?:direct(?:ed)?|send|forward)\s+(?:(?:any|your|all|future)\s+)*(?:inquiries|enquiries|questions|requests|messages)\s+to)\b/gi;
  const candidates=[];
  for(const paragraph of authored.join('\n').split(/\n\s*\n/)){
    for(const match of paragraph.matchAll(route)){
      const remainder=paragraph.slice(match.index+match[0].length,match.index+match[0].length+800);
      const clause=(remainder.match(/^[\s\S]*?(?:[.!?](?=\s|$)|$)/)||[])[0]||'';
      candidates.push(...(clause.match(/[a-z0-9.!#$%&'*+/?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[]).map(addr).filter(Boolean));
    }
  }
  const old=addr(auto.from??auto.from_)||'';
  return uniq(candidates).filter(c=>c!==old&&!mailboxes.has(c));
}
const receipt=m=>({accountId:m.accountId||null,accountEmail:m.accountEmail||null,messageId:m.id||m.messageId,at:new Date(m.email_ts||m.sentAt).toISOString(),from:addr(m.from??m.from_)||'',to:asList(m.to).map(addr).filter(Boolean),url:m.display_url||m.displayUrl||m.receiptUrl||null,subject:value(m.subject)});
function answers(human,outbound){
  if(outbound._time<=human._time)return false;
  const sender=addr(human.from??human.from_);
  if(![...asList(outbound.to),...asList(outbound.cc)].map(addr).includes(sender))return false;
  if(human.rfcMessageId&&asList(outbound.references).includes(human.rfcMessageId))return true;
  const account=value(human.accountId||human.accountEmail);
  return !!account&&account===value(outbound.accountId||outbound.accountEmail)&&
    !!human.thread_id&&human.thread_id===outbound.thread_id;
}
export function triage(input, now=new Date()){
  must(input&&typeof input==='object'&&!Array.isArray(input),'Input must be object');
  must(Array.isArray(input.cases)&&input.cases.length&&Array.isArray(input.messages),'cases[] and messages[] required');
  must(Number.isFinite(now.getTime()),'Invalid now');
  const cs=new Map();for(const c of input.cases){
    must(value(c.id)&&value(c.owner)&&url(c.sourceUrl),`case ${c.id}: id, owner, issuer HTTPS sourceUrl required`);
    must(!cs.has(c.id),`Duplicate case ${c.id}`);
    const due=c.deadline?iso(c.deadline,`${c.id}.deadline`):null;
    cs.set(c.id,{...c,due});
  }
  const seen=new Set(),groups=new Map([...cs.keys()].map(k=>[k,[]]));
  for(const [i,m] of input.messages.entries()){
    must(cs.has(m.caseId),`messages[${i}]: explicit known caseId required`);
    const mid=value(m.id||m.messageId);
    const identity=value(m.accountId||m.accountEmail)+':'+mid;
    must(mid&&!seen.has(identity),`messages[${i}]: unique account/provider id required`);seen.add(identity);
    must(url(m.display_url||m.displayUrl||m.receiptUrl),`messages[${i}]: provider HTTPS receipt required`);
    const t=iso(m.email_ts||m.sentAt,`messages[${i}].email_ts`);
    must(t<=now,`messages[${i}]: future provider event`);
    must(addr(m.from??m.from_),`messages[${i}]: valid sender required`);
    must(asList(m.to).some(addr),`messages[${i}]: recipient required`);
    must(Array.isArray(m.labels),`messages[${i}]: labels[] required`);
    groups.get(m.caseId).push({...m,_time:t,_kind:kind(m)});
  }
  const mailboxes=new Set([
    ...(input.accounts||[]).map(a=>addr(a.email)),
    ...input.messages.map(m=>addr(m.accountEmail)),
    ...input.messages.filter(m=>kind(m)==='SENT').map(m=>addr(m.from??m.from_))
  ].filter(Boolean));
  const output=[];
  for(const [caseId,c] of cs){
    const messages=groups.get(caseId).sort((a,b)=>a._time-b._time),sent=messages.filter(m=>m._kind==='SENT');
    const received=messages.filter(m=>m._kind!=='SENT'&&m._kind!=='DRAFT');
    const human=received.filter(m=>m._kind==='HUMAN_REVIEW');
    const automated=received.filter(m=>m._kind==='AUTO_REPLY');
    const bounced=received.filter(m=>m._kind==='BOUNCE');
    const unread=messages.filter(m=>m._kind!=='DRAFT'&&((m._kind!=='SENT'&&m.detail&&m.detail!=='FULL_HEADERS')||m.captureIssues?.includes('MESSAGE_IDENTITY_CONFLICT')));
    const lastSent=sent.at(-1),lastHuman=human.at(-1);
    const answeredBy=new Map(human.map(m=>[m,sent.find(s=>answers(m,s))]));
    const unanswered=human.filter(m=>!answeredBy.get(m)),lastUnanswered=unanswered.at(-1);
    const routed=uniq(automated.flatMap(a=>routedContacts(a,mailboxes)));
    const alreadyRouted=routed.filter(to=>sent.some(m=>asList(m.to).map(addr).includes(to)));
    const routePending=routed.filter(to=>!alreadyRouted.includes(to));
    const dueHours=c.due?(c.due-now)/36e5:null;
    const sinceSent=lastSent?(now-lastSent._time)/36e5:null;
    const disposition=m=>['INTEREST','DECLINE','NEUTRAL'].includes(m.humanDisposition)?m.humanDisposition:'UNREVIEWED';
    const dispositions=human.map(m=>({accountId:m.accountId||null,messageId:m.id||m.messageId,disposition:disposition(m),url:receipt(m).url,answeredBy:answeredBy.get(m)?receipt(answeredBy.get(m)):null}));
    let status,action;
    if(unread.length){status='MESSAGE_CONTENT_REQUIRED';action='Read the listed full Gmail messages, then resume this queue with the returned native capture';
    } else if(lastHuman&&disposition(lastHuman)==='DECLINE'){
      status='HUMAN_DECLINE';action='Record decline; stop pursuing this contact';
    } else if(lastUnanswered){
      const state=disposition(lastUnanswered);
      status=state==='INTEREST'?'HUMAN_INTEREST':state==='DECLINE'?'HUMAN_DECLINE':state==='NEUTRAL'?'HUMAN_NEUTRAL':'HUMAN_REPLY_NEEDS_TRIAGE';
      action=state==='INTEREST'?'Relationship owner: respond in original thread with a concrete scoped acceptance offer and ask for a decision date':state==='DECLINE'?'Record decline; stop pursuing this contact':'Relationship owner: read the actual human response and decide the next tailored action';
    } else if(lastHuman){
      status=sinceSent<FIRST_CONTACT_FOLLOWUP_HOURS?'OUTBOUND_AWAITING_REPLY':'FOLLOWUP_REVIEW';
      action=status==='OUTBOUND_AWAITING_REPLY'?'The human messages have verified replies; await the recipient\'s response':'Relationship owner: review the already answered conversation for a justified follow-up in its original thread';
    } else if(routePending.length){status='CONTACT_ROUTING_AVAILABLE';action=`Automatic reply provided replacement address ${routePending.join(', ')}. Verify role and prior sent history; send one addressed approach if still relevant`;
    } else if(alreadyRouted.length){status='CONTACT_ROUTED_AWAITING_REPLY';action=`Replacement contact ${alreadyRouted.join(', ')} already received an outbound message; wait for human response`;
    } else if(bounced.length){status='DELIVERY_FAILURE';action='Verify the mailbox and identify one current named contact from the original provider before retrying';
    } else if(!sent.length){status='NO_VERIFIED_SEND';action='Check latest owner contact history; no provider SENT receipt is present for this case';
    } else if(sinceSent<FIRST_CONTACT_FOLLOWUP_HOURS){status='OUTBOUND_AWAITING_REPLY';action='Recent first contact; monitor for reply and avoid duplicate introduction';
    } else {status='FOLLOWUP_REVIEW';action='Relationship owner: consider one specific follow-up in the original thread if deadline and relationship still justify it';}
    if(c.due&&dueHours<=0&&status!=='HUMAN_INTEREST')action='Buyer opportunity deadline has passed; verify any continuing paid implementation need before outreach';
    const ordered=[...sent,...received].sort((a,b)=>a._time-b._time);
    output.push({caseId,owner:c.owner,sourceUrl:c.sourceUrl,deadline:c.due?.toISOString()||null,deadlineHours:dueHours===null?null:Number(dueHours.toFixed(1)),status,nextAction:action,sentCount:sent.length,inboundCount:received.length,humanReplyCount:human.length,unansweredHumanReplyCount:unanswered.length,draftCount:messages.filter(m=>m._kind==='DRAFT').length,autoReplyCount:automated.length,bounceCount:bounced.length,contentReadCount:unread.length,replacementContacts:routed,alreadyContacted:alreadyRouted,dispositions,latestSent:lastSent?receipt(lastSent):null,latestHuman:lastHuman?receipt(lastHuman):null,latestUnansweredHuman:lastUnanswered?receipt(lastUnanswered):null,latestHumanAnsweredBy:lastHuman&&answeredBy.get(lastHuman)?receipt(answeredBy.get(lastHuman)):null,receipts:ordered.map(m=>({...receipt(m),kind:m._kind}))});
  }
  const importance={MESSAGE_CONTENT_REQUIRED:0,HUMAN_INTEREST:0,HUMAN_REPLY_NEEDS_TRIAGE:1,CONTACT_ROUTING_AVAILABLE:2,DELIVERY_FAILURE:3,FOLLOWUP_REVIEW:4,HUMAN_NEUTRAL:5,NO_VERIFIED_SEND:6,CONTACT_ROUTED_AWAITING_REPLY:7,OUTBOUND_AWAITING_REPLY:8,HUMAN_DECLINE:9};
  output.sort((a,b)=>(importance[a.status]??10)-(importance[b.status]??10)||(a.deadlineHours??Infinity)-(b.deadlineHours??Infinity)||a.caseId.localeCompare(b.caseId));
  const totals={cases:output.length,verifiedSent:output.reduce((n,x)=>n+x.sentCount,0),humanReplyCases:output.filter(x=>x.humanReplyCount>0).length,autoOnlyCases:output.filter(x=>x.autoReplyCount>0&&x.humanReplyCount===0).length,interestCases:output.filter(x=>x.status==='HUMAN_INTEREST').length};
  return {generatedAt:now.toISOString(),source:'OPERATOR_SUPPLIED_PROVIDER_GMAIL',totals,cases:output};
}
export function markdown(result){
  let s=`# Reply → next-action operating queue\n\nGenerated ${result.generatedAt}. Provider-backed messages mapped to operator-provided cases; no outbound action or account mutation performed.\n\nCases ${result.totals.cases}; verified SENT ${result.totals.verifiedSent}; cases with human responses ${result.totals.humanReplyCases}; auto-only ${result.totals.autoOnlyCases}; annotated interest ${result.totals.interestCases}.\n`;
  for(const c of result.cases){
    s+=`\n## ${c.caseId} | ${c.status}\n\nOwner: ${c.owner}. Deadline: ${c.deadline||'not supplied'}. ${c.sentCount} SENT / ${c.humanReplyCount} human / ${c.autoReplyCount} auto / ${c.bounceCount} bounce.\n\nNext: ${c.nextAction}\n\nIssuer: ${c.sourceUrl}\n`;
    if(c.latestSent)s+=`\nLatest outbound: ${c.latestSent.url}\n`;
    if(c.latestHuman)s+=`\nLatest human reply: ${c.latestHuman.url}\n`;
    if(c.latestUnansweredHuman)s+=`\nLatest unanswered human reply: ${c.latestUnansweredHuman.url}\n`;
    if(c.latestHumanAnsweredBy)s+=`\nVerified response to latest human reply: ${c.latestHumanAnsweredBy.url}\n`;
    if(c.autoReplyCount)s+=`\nAutomatic replies: ${c.receipts.filter(x=>x.kind==='AUTO_REPLY').map(x=>x.url).join(', ')}\n`;
    if(c.dispositions.length)s+=`\nHuman annotations: ${c.dispositions.map(x=>x.disposition).join(', ')}\n`;
  }
  return s;
}
async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args.includes('--help')){console.log('Usage: node reply-triage.mjs <provider-messages.json> <output-dir> [--now=2026-10-11T13:00:00Z]');return;}
  must(args.length>=2,'Input JSON and output directory required');
  const raw=JSON.parse(await readFile(args[0],'utf8'));
  const nowArg=args.find(a=>a.startsWith('--now='));const now=nowArg?iso(nowArg.slice(6),'--now'):new Date();
  const result=triage(raw,now);
  const dest=path.resolve(args[1]);await mkdir(dest,{recursive:true});
  await writeFile(path.join(dest,'reply-queue.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(path.join(dest,'reply-queue.md'),markdown(result));
  console.log(JSON.stringify({outputDir:dest,...result.totals}));
}
if(process.argv[1]&&import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
