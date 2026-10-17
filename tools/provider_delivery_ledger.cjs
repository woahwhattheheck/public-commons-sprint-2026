'use strict';
// Offline reconciliation only. No network, mail sending, timers or automatic retry.
const SCHEMA='provider-delivery-ledger.v1';
function fail(s){throw Error(s);}
function required(v,n){if(typeof v!=='string'||!v.trim())fail(n+' is required');return v.trim();}
function iso(v,n){v=required(v,n);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v)))fail(n+' must be a UTC ISO timestamp');return new Date(v).toISOString();}
function mailbox(v){v=required(v,'mailbox');const a=/^[^<>]*<([^<>]+)>$/.exec(v);v=(a?a[1]:v).trim().toLowerCase();if(!/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(v))fail('Invalid mailbox');return v;}
function headers(p,name){return (p?.headers||[]).filter(h=>String(h.name).toLowerCase()===name.toLowerCase()).map(h=>String(h.value));}
function one(p,name,optional=false){const a=headers(p,name);if(a.length!==1){if(optional&&!a.length)return '';fail('Expected one '+name+' header');}return a[0];}
function mids(s){return [...new Set((s.match(/<[^<>\s]+@[^<>\s]+>/g)||[]))];}
function recipients(p){const result=[];for(const name of ['To','Cc','Bcc'])for(const h of headers(p,name)){const list=h.match(/[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];for(const a of list)result.push(mailbox(a));}return [...new Set(result)].sort();}
function providerTime(m){const v=String(m.internal_date??m.internalDate??'');if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v)))fail('Missing provider internal date');return new Date(Number(v)).toISOString();}
function key(account,id){return mailbox(account)+'/'+required(id,'provider message ID');}
function envelope(m){if(!m||typeof m!=='object'||!m.payload)fail('Full Gmail message required');return {provider_id:required(m.id,'provider message ID'),thread_id:required(m.thread_id??m.threadId,'thread ID'),provider_at:providerTime(m)};}
function sentObservation(o){
 const m=o.message,e=envelope(m),labels=m.label_ids??m.labelIds??[];
 if(!labels.includes('SENT')||labels.includes('DRAFT'))fail('Only confirmed SENT messages consume a slot');
 const from=mailbox(one(m.payload,'From'));if(from!==mailbox(o.account))fail('Sender differs from account');
 const to=recipients(m.payload);if(!to.length)fail('SENT recipients missing');
 const rfc=mids(one(m.payload,'Message-ID',true));if(rfc.length>1)fail('Ambiguous Message-ID');
 return {...e,account:from,recipients:to,rfc_message_id:rfc[0]||null,subject:one(m.payload,'Subject',true),sent_at:e.provider_at};
}
function walk(p,fn){fn(p);for(const x of p.parts||[])walk(x,fn);}
function bodyText(p){const parts=[];walk(p,x=>{if(typeof x.body?.content==='string')parts.push(x.body.content);});return parts.join('\r\n');}
function fieldBlocks(s,strict=true){
 return s.replace(/\r\n/g,'\n').replace(/\n[ \t]+/g,' ').split(/\n[ \t]*\n/).map(block=>{
  const out={};for(const line of block.split('\n')){const m=/^([^:\s]+):[ \t]*(.*)$/.exec(line);if(m){const k=m[1].toLowerCase();if(out[k]!==undefined){if(strict||k==='message-id')fail('Duplicate field: '+k);continue;}out[k]=m[2].trim();}}return out;
 });
}
function rfcRecipient(v){if(!v)return null;const m=/^rfc822\s*;\s*(.+)$/i.exec(v);if(!m)return null;try{return mailbox(m[1]);}catch{return null;}}
function dsnObservation(o){
 const m=o.message,e=envelope(m),sections=[],embedded=[];
 walk(m.payload,p=>{
  const type=String(p.mime_type??p.mimeType??'').toLowerCase().split(';')[0];
  if(type==='message/delivery-status')sections.push(bodyText(p));
  if(type==='text/rfc822-headers')for(const b of fieldBlocks(bodyText(p),false))embedded.push(...mids(b['message-id']||''));
  if(type==='message/rfc822')for(const ch of p.parts||[])embedded.push(...mids(one(ch,'Message-ID',true)));
 });
 const direct=mids(headers(m.payload,'In-Reply-To').join(' '));
 // Embedded original identity takes precedence; References may include unrelated ancestors.
 const originalIds=[...new Set(embedded.length?embedded:direct)];
 const reports=[];
 for(const text of sections)for(const f of fieldBlocks(text)){
  if(!f['final-recipient'])continue;
  const action=(f.action||'').toLowerCase(),status=f.status||'';
  if(!['failed','delayed','delivered','relayed','expanded'].includes(action)||!/^[245]\.\d{1,3}\.\d{1,3}$/.test(status))fail('Invalid structured DSN action/status');
  const cls=action==='failed'?'5':action==='delayed'?'4':'2';if(status[0]!==cls)fail('Conflicting DSN action/status');
  const final=rfcRecipient(f['final-recipient']),original=rfcRecipient(f['original-recipient']);
  reports.push({action,status,final_recipient:final,original_recipient:original,diagnostic:f['diagnostic-code']||'',last_attempt_at:f['last-attempt-date']||null,fields:f});
 }
 const account=mailbox(o.account),plain=[];walk(m.payload,p=>{if((p.mime_type??p.mimeType)==='text/plain'&&typeof p.body?.content==='string')plain.push(p.body.content);});
 const rejection='One of your attachments contained a virus. Your message was not sent.';
 let provider_rejection=null;
 if(!sections.length&&plain.some(t=>t.trimStart().startsWith(rejection+'\r\n')||t.trimStart().startsWith(rejection+'\n')||t.trim()===rejection)){
  try{if(mailbox(one(m.payload,'From'))==='mailer-daemon@googlemail.com'&&recipients(m.payload).includes(account)&&originalIds.length===1)provider_rejection={kind:'gmail-attachment-rejection',diagnostic:rejection};}catch{}
 }
 return {...e,account,original_message_ids:originalIds,reports,structured:sections.length>0,provider_rejection};
}
function empty(){return {schema:SCHEMA,sends:[],notifications:[]};}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function evidence(o){return {observed_at:iso(o.observed_at,'observed_at'),source_ref:required(o.source_ref,'source_ref')};}
function add(rows,k,value,proof){
 const old=rows.find(x=>x.key===k);
 if(old){if(stable(old.value)!==stable(value))fail('Provider identity conflict: '+k);if(!old.observations.some(x=>stable(x)===stable(proof)))old.observations.push(proof);}
 else rows.push({key:k,value,observations:[proof]});
}
function reconcile(state){
 const records=state.sends.map(row=>({...row.value,key:row.key,observations:row.observations,status:'sent',outcomes:[]}));
 const unresolved=[];
 for(const row of state.notifications){const n=row.value;
  if(n.provider_rejection){
   const matches=records.filter(s=>s.account===n.account&&s.rfc_message_id&&n.original_message_ids.includes(s.rfc_message_id));
   if(matches.length!==1||Date.parse(n.provider_at)<Date.parse(matches[0]?.sent_at)){unresolved.push({notification_key:row.key,reason:'provider-rejection-original-not-matched'});continue;}
   for(const recipient of matches[0].recipients)matches[0].outcomes.push({action:'failed',status:null,final_recipient:recipient,original_recipient:recipient,diagnostic:n.provider_rejection.diagnostic,provider_notice_kind:n.provider_rejection.kind,notification_key:row.key,provider_at:n.provider_at,report_index:0,source_refs:row.observations.map(x=>x.source_ref)});
   continue;
  }
  if(!n.structured||!n.reports.length){unresolved.push({notification_key:row.key,reason:'no-readable-structured-report'});continue;}
  for(let i=0;i<n.reports.length;i++){const report=n.reports[i],candidates=records.filter(s=>
   s.account===n.account&&s.rfc_message_id&&n.original_message_ids.includes(s.rfc_message_id)&&
   [report.original_recipient,report.final_recipient].some(r=>r&&s.recipients.includes(r)));
   if(candidates.length!==1){unresolved.push({notification_key:row.key,report_index:i,reason:candidates.length?'ambiguous-original':'original-not-yet-matched'});continue;}
   const s=candidates[0];if(Date.parse(n.provider_at)<Date.parse(s.sent_at)){unresolved.push({notification_key:row.key,report_index:i,reason:'notification-precedes-send'});continue;}
   s.outcomes.push({...report,notification_key:row.key,provider_at:n.provider_at,report_index:i,source_refs:row.observations.map(x=>x.source_ref)});
  }
 }
 for(const s of records){
  s.recipient_status=s.recipients.map(recipient=>{
   const events=s.outcomes.filter(x=>[x.original_recipient,x.final_recipient].includes(recipient)).sort((a,b)=>a.provider_at.localeCompare(b.provider_at)||a.notification_key.localeCompare(b.notification_key)||a.report_index-b.report_index);
   const terminal=new Set(events.filter(x=>['failed','delivered'].includes(x.action)).map(x=>x.action));
   const last=events[events.length-1],status=terminal.size>1?'conflict':terminal.has('failed')?'failed':terminal.has('delivered')?'delivered':last?.action||'sent';
   return {recipient,status};
  });
  const statuses=s.recipient_status.map(x=>x.status);
  s.status=statuses.includes('conflict')?'conflict':statuses.every(x=>x==='failed')?'failed':statuses.includes('failed')?'partial-failure':statuses.every(x=>x==='delivered')?'delivered':statuses.includes('delayed')?'delayed':statuses.some(x=>x==='relayed'||x==='expanded')?'forwarded':'sent';
 }
 return {records,unresolved};
}
function validate(state){
 if(state?.schema!==SCHEMA||!Array.isArray(state.sends)||!Array.isArray(state.notifications))fail('Invalid retained ledger');
 for(const rows of [state.sends,state.notifications]){const seen=new Set();for(const row of rows){if(seen.has(row.key)||key(row.value.account,row.value.provider_id)!==row.key)fail('Invalid or duplicate ledger identity');seen.add(row.key);if(!Array.isArray(row.observations)||!row.observations.length)fail('Observation source missing');for(const e of row.observations)evidence(e);}}
}
function applyObservations(original,observations){
 validate(original);if(!Array.isArray(observations))fail('Observations must be an array');const state=JSON.parse(JSON.stringify(original));
 for(const o of observations){const proof=evidence(o);if(o.kind==='sent'){const v=sentObservation(o);add(state.sends,key(v.account,v.provider_id),v,proof);}
 else if(o.kind==='dsn'){const v=dsnObservation(o);add(state.notifications,key(v.account,v.provider_id),v,proof);}else fail('Unsupported observation kind');}
 state.sends.sort((a,b)=>a.key.localeCompare(b.key));state.notifications.sort((a,b)=>a.key.localeCompare(b.key));
 return {state,...reconcile(state)};
}
function windowSummary(state,{account,start,end,limit}){
 validate(state);account=mailbox(account);start=iso(start,'start');end=iso(end,'end');if(start>=end||!Number.isInteger(limit)||limit<0)fail('Invalid quota window');
 const result=reconcile(state),records=result.records.filter(s=>s.account===account&&s.sent_at>=start&&s.sent_at<end),statuses={};
 for(const s of records)statuses[s.status]=(statuses[s.status]||0)+1;
 return {account,start,end,limit,confirmed_send_slots:records.length,remaining_send_slots:Math.max(0,limit-records.length),over_limit:Math.max(0,records.length-limit),statuses,unresolved_notifications:result.unresolved.filter(n=>n.notification_key.startsWith(account+'/')).length,records};
}
module.exports={empty,applyObservations,reconcile,windowSummary,parseDeliveryStatus:dsnObservation};
