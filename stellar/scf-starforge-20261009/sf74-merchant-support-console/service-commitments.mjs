// MIT. Service terms and operating reports in the original SF74 saved case.
export const SERVICE_SCHEMA='stellar-forge.merchant-service-case.v1';
export const SERVICE_SOURCE_SCHEMA='stellar-forge.merchant-service-source.v1';
export const SERVICE_REPORT_SCHEMA='stellar-forge.merchant-service-report.v1';
export const MAX_SERVICE_BYTES=8_000_000;
export const SERVICE_INCIDENT_KINDS=['ENDPOINT_UNAVAILABLE','OBSERVER_INCOMPLETE','HTTP_5XX','DISCONNECTED','DELIVERY_UNAVAILABLE','DELIVERY_BACKLOG','DELIVERY_EXHAUSTED'];
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const MINUTE=60000,DAY=86400000;
const clone=value=>structuredClone(value);
const fail=(code,message)=>Object.assign(new Error(message),{code,status:422});
const problem=message=>{throw fail('SERVICE_INPUT_INVALID',message);};
const object=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))problem('Use an object for '+label+'.');return value;};
const fields=(value,names,label)=>{object(value,label);if(Object.keys(value).some(k=>!names.includes(k)))problem('Unknown '+label+' field.');return value;};
const list=(value,label,maximum=10000)=>{if(!Array.isArray(value)||value.length>maximum)problem('Use a complete '+label+' list within '+maximum+' entries.');return value;};
const text=(value,label,max=4000,required=true)=>{
  if(typeof value!=='string'||enc.encode(value).length>max||dec.decode(enc.encode(value))!==value||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))problem('Enter valid '+label+'.');
  value=value.trim();if(required&&!value)problem('Enter '+label+'.');return value;
};
const integer=(value,label,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(value)||value<min||value>max)problem('Enter '+label+' as a whole number from '+min+' to '+max+'.');return value;};
const id=(value,label='record ID')=>{if(typeof value!=='string'||!UUID.test(value))problem('Use the original '+label+'.');return value;};
const digest=(value,label='source hash')=>{if(typeof value!=='string'||!SHA.test(value))problem('Use the original '+label+'.');return value;};
const alias=(value,label)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value))problem('Choose a valid '+label+'.');return value;};
const utc=(value,label='time')=>{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)problem('Enter '+label+' as an exact UTC timestamp.');return value;};
const date=(value,label='date')=>{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value<'1900-01-01'||value>'2199-12-31')problem('Enter a real '+label+' from 1900 through 2199.');return value;};
function json(value,depth=0){
  if(depth>80)problem('The saved service data is too deeply nested.');
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))problem('The saved service data has a non-finite number.');return JSON.stringify(value);}
  if(typeof value==='string'){if(dec.decode(enc.encode(value))!==value)problem('The saved service data has invalid Unicode.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(v=>json(v,depth+1)).join(',')+']';
  object(value,'saved service data');return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+json(value[k],depth+1)).join(',')+'}';
}
export const serviceCanonical=json;
export async function serviceSha256(value){const bytes=typeof value==='string'?enc.encode(value):enc.encode(json(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
const withoutSeal=value=>Object.fromEntries(Object.entries(value).filter(([k])=>k!=='sha256'));
async function seal(value){return {...value,sha256:await serviceSha256(value)};}
async function checkSeal(value,label){digest(value.sha256,label+' hash');if(await serviceSha256(withoutSeal(value))!==value.sha256)problem('The retained '+label+' changed.');}
function withinSize(record){if(enc.encode(json(record)).length>MAX_SERVICE_BYTES)problem('The complete service case exceeds 8 MB. Preserve its complete original handoff before starting another service case.');return record;}
function draft(value){object(value,'unfinished service form');if(enc.encode(json(value)).length>160000)problem('The unfinished service form exceeds 160 KB.');return clone(value);}
export function createServiceRecord(){return {schema:SERVICE_SCHEMA,terms:[],captures:[],exclusions:[],reports:[],draft:{}};}
const formatters=new Map(),boundaryCache=new Map();
function formatter(zone){
  let f=formatters.get(zone);if(!f){try{f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});f.format(0);}catch{problem('Choose an installed IANA service time zone.');}formatters.set(zone,f);}return f;
}
function localParts(ms,zone){return Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
function localDate(ms,zone){const p=localParts(ms,zone);return p.year+'-'+p.month+'-'+p.day;}
function plusDate(day,count){return new Date(Date.parse(day+'T00:00:00Z')+count*DAY).toISOString().slice(0,10);}
function clock(value,end=false){if(typeof value!=='string'||!(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)||end&&value==='24:00'))problem('Use a service time such as 09:00 or an ending time of 24:00.');return value;}
function windows(value){
  const rows=list(value,'daily service windows',12).map(v=>{fields(v,['start','end'],'service window');const start=clock(v.start),end=clock(v.end,true);if(start>=end)problem('Each daily service window must end after it starts; split overnight coverage at midnight.');return {start,end};}).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<rows.length;i++)if(rows[i].start<rows[i-1].end)problem('Daily service windows overlap.');return rows;
}
function normalizeCalendar(value){
  fields(value,['mode','timeZone','week','exceptions'],'service calendar');
  if(!['always','business'].includes(value.mode))problem('Choose continuous or business service hours.');
  const timeZone=text(value.timeZone,'service time zone',100);formatter(timeZone);
  const week=list(value.week??[],'weekly schedule',7).map(v=>{fields(v,['day','windows'],'weekday');return {day:integer(v.day,'weekday',1,7),windows:windows(v.windows)};}).sort((a,b)=>a.day-b.day);
  if(new Set(week.map(v=>v.day)).size!==week.length)problem('A weekday is repeated.');
  const exceptions=list(value.exceptions??[],'dated calendar exceptions',1000).map(v=>{fields(v,['date','windows'],'calendar exception');return {date:date(v.date),windows:windows(v.windows)};}).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(exceptions.map(v=>v.date)).size!==exceptions.length)problem('A calendar exception date is repeated.');
  if(value.mode==='business'&&!week.some(v=>v.windows.length))problem('Choose at least one weekly service window.');
  return {mode:value.mode,timeZone,week,exceptions};
}
// Ambiguous local boundaries use the earliest start/latest end. A skipped local
// boundary advances to the first real minute. Each selected calendar retains this rule.
function boundary(day,time,zone,side){
  if(time==='24:00'){day=plusDate(day,1);time='00:00';}
  const key=day+'|'+time+'|'+zone+'|'+side;if(boundaryCache.has(key))return boundaryCache.get(key);
  const naive=Date.parse(day+'T'+time+':00.000Z');
  for(let shift=0;shift<=1500;shift++){
    const local=new Date(naive+shift*MINUTE).toISOString().slice(0,16),want=local.replace('T',' ');
    const base=Date.parse(local+':00.000Z'),offsets=new Set();
    for(let hours=-36;hours<=36;hours+=12){
      const probe=base+hours*3600000,p=localParts(probe,zone);
      offsets.add(Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'.000Z')-probe);
    }
    const matches=[];
    for(const offset of offsets){const candidate=base-offset,p=localParts(candidate,zone);if(p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute===want)matches.push(candidate);}
    if(matches.length){const result=side==='end'?Math.max(...matches):Math.min(...matches);boundaryCache.set(key,result);if(boundaryCache.size>12000)boundaryCache.delete(boundaryCache.keys().next().value);return result;}
  }
  problem('The selected calendar boundary cannot be resolved in '+zone+'.');
}
function dayWindows(day,calendar){
  const exception=calendar.exceptions.find(v=>v.date===day);
  if(exception)return exception.windows;
  if(calendar.mode==='always')return [{start:'00:00',end:'24:00'}];
  const weekday=new Date(day+'T12:00:00Z').getUTCDay()||7;
  return calendar.week.find(v=>v.day===weekday)?.windows??[];
}
function union(intervals){
  const rows=intervals.filter(v=>v[1]>v[0]).map(v=>[v[0],v[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),out=[];
  for(const row of rows){const last=out.at(-1);if(last&&row[0]<=last[1])last[1]=Math.max(last[1],row[1]);else out.push(row);}return out;
}
function subtract(intervals,excluded){
  const holes=union(excluded),out=[];
  for(const [from,through]of intervals){let cursor=from;for(const [a,b]of holes){if(b<=cursor)continue;if(a>=through)break;if(a>cursor)out.push([cursor,Math.min(a,through)]);cursor=Math.max(cursor,b);if(cursor>=through)break;}if(cursor<through)out.push([cursor,through]);}return out;
}
function serviceIntervals(from,through,calendar){
  if(through<=from)return [];
  if(through-from>3660*DAY)problem('Choose an incident clock of ten years or less.');
  const first=localDate(from,calendar.timeZone),last=localDate(through-1,calendar.timeZone),out=[];
  for(let day=first;day<=last;day=plusDate(day,1)){
    for(const window of dayWindows(day,calendar)){
      const a=Math.max(from,boundary(day,window.start,calendar.timeZone,'start'));
      const b=Math.min(through,boundary(day,window.end,calendar.timeZone,'end'));
      if(b>a)out.push([a,b]);
    }
  }
  return union(out);
}
const milliseconds=intervals=>intervals.reduce((sum,[a,b])=>sum+b-a,0);
function deadline(from,target,calendar,excluded){
  const first=localDate(from,calendar.timeZone);let remaining=target;
  for(let index=0;index<=3660;index++){
    const day=plusDate(first,index),spans=dayWindows(day,calendar).map(w=>[Math.max(from,boundary(day,w.start,calendar.timeZone,'start')),boundary(day,w.end,calendar.timeZone,'end')]);
    for(const [a,b]of subtract(union(spans),excluded)){if(b-a>=remaining)return new Date(a+remaining).toISOString();remaining-=b-a;}
  }
  return null;
}
function normalizeTerms(input,revision,createdAt){
  const keys=['id','expectedRevision','title','customer','owner','reference','status','incidentSourceId','merchantId','merchantBinding','effectiveFrom','effectiveUntil','calendar','targets','reviewedBy','note'];
  fields(input,keys,'service terms');
  const status=input.status;if(!['proposed','active','ended'].includes(status))problem('Choose proposed, active or ended terms.');
  const effectiveFrom=utc(input.effectiveFrom,'service start'),effectiveUntil=input.effectiveUntil==null||input.effectiveUntil===''?null:utc(input.effectiveUntil,'service end');
  if(effectiveUntil&&effectiveUntil<=effectiveFrom)problem('The service end must follow its start.');
  if(status==='ended'&&!effectiveUntil)problem('Record the original service end for ended terms.');
  const reference=text(input.reference??'','accepted terms reference',4000,status!=='proposed');
  const targets=list(input.targets,'incident targets',SERVICE_INCIDENT_KINDS.length).map(row=>{
    fields(row,['kind','responseMinutes','recoveryMinutes'],'incident target');
    if(!SERVICE_INCIDENT_KINDS.includes(row.kind))problem('Choose an original incident condition.');
    return {kind:row.kind,responseMinutes:integer(row.responseMinutes,'response target minutes',1,527040),recoveryMinutes:integer(row.recoveryMinutes,'recovery target minutes',1,527040)};
  }).sort((a,b)=>a.kind.localeCompare(b.kind));
  if(!targets.length||new Set(targets.map(v=>v.kind)).size!==targets.length)problem('Choose distinct original incident targets.');
  return {schema:'stellar-forge.merchant-service-terms.v1',id:id(input.id),revision,createdAt,
    title:text(input.title,'service name',400),customer:text(input.customer,'customer',400),owner:text(input.owner,'responsible owner',400),reference,status,
    incidentSourceId:alias(input.incidentSourceId,'declared incident source'),merchantId:alias(input.merchantId,'registered merchant'),merchantBinding:digest(input.merchantBinding,'merchant binding'),
    effectiveFrom,effectiveUntil,calendar:normalizeCalendar(input.calendar),targets,
    reviewedBy:text(input.reviewedBy,'terms reviewer',240),note:text(input.note??'','terms note',8000,false),
    clockPolicy:'elapsed-actual-service-windows;ambiguous-earliest-start-latest-end;skipped-boundary-next-real-minute'};
}
function termsInput(value){
  const keys=['id','title','customer','owner','reference','status','incidentSourceId','merchantId','merchantBinding','effectiveFrom','effectiveUntil','calendar','targets','reviewedBy','note'];
  return {...Object.fromEntries(keys.map(k=>[k,clone(value[k])])),expectedRevision:value.revision===1?null:value.revision-1};
}
function validateIncident(value,snapshot){
  object(value,'original incident');id(value.id,'incident ID');alias(value.merchantId,'merchant');
  if(value.merchantId!==snapshot.merchant.id)problem('An incident belongs to another original merchant.');
  digest(value.binding,'incident merchant binding');
  if(!SERVICE_INCIDENT_KINDS.includes(value.kind)||!['OPEN','ACKNOWLEDGED','RECOVERED','RETIRED'].includes(value.status))problem('The original incident condition or state is invalid.');
  integer(value.revision,'incident revision',1);utc(value.openedAt,'incident opening');utc(value.updatedAt,'incident update');utc(value.lastObservedAt,'last incident observation');
  if(Date.parse(value.openedAt)>Date.parse(snapshot.capturedAt)+5000)problem('An incident opens after its source capture.');
  if(value.closedAt!==null){utc(value.closedAt,'incident close');if(value.closedAt<value.openedAt)problem('The original incident closes before opening.');}
  if(['RECOVERED','RETIRED'].includes(value.status)!==Boolean(value.closedAt))problem('The original incident close does not match its state.');
  if(value.acknowledgment){object(value.acknowledgment,'original acknowledgment');utc(value.acknowledgment.at,'acknowledgment time');text(value.acknowledgment.by,'acknowledging owner',2000);if(value.acknowledgment.at<value.openedAt)problem('The acknowledgment precedes the original opening.');}
  if(value.status==='ACKNOWLEDGED'&&!value.acknowledgment)problem('The original acknowledged incident lacks its acknowledgment.');
}
function normalizeSnapshot(value){
  fields(value,['schema','capturedAt','source','merchant','revision','configRevision','configHash','retention','incidents'],'incident source snapshot');
  if(value.schema!==SERVICE_SOURCE_SCHEMA)problem('Choose an original service incident snapshot.');
  utc(value.capturedAt,'source capture time');fields(value.source,['id','label'],'incident source');alias(value.source.id,'declared incident source');text(value.source.label,'source label',500);
  fields(value.merchant,['id','label','binding','registered'],'registered merchant');if(value.merchant.registered!==undefined&&typeof value.merchant.registered!=='boolean')problem('The original registration state is invalid.');alias(value.merchant.id,'merchant');text(value.merchant.label,'merchant label',500);digest(value.merchant.binding,'merchant binding');
  integer(value.revision,'source revision',1);integer(value.configRevision,'configuration revision',1);digest(value.configHash,'configuration hash');object(value.retention,'original retention settings');
  const found=new Set();for(const incident of list(value.incidents,'original incidents',5000)){validateIncident(incident,value);if(found.has(incident.id))problem('An original incident is repeated in the capture.');found.add(incident.id);}
  return clone(value);
}
export function validateServiceSnapshot(value){const normalized=normalizeSnapshot(value);if(enc.encode(json(normalized)).length>MAX_SERVICE_BYTES)problem('The complete original merchant incident snapshot exceeds the service case size.');return normalized;}
function normalizeExclusion(input,captures,createdAt){
  fields(input,['id','incidentId','captureSha256','from','through','scope','reason','reference','reviewedBy'],'clock exclusion');
  const capture=captures.find(v=>v.sha256===digest(input.captureSha256,'capture hash'));if(!capture)problem('Retain the original incident capture before reviewing an exclusion.');
  const incident=capture.snapshot.incidents.find(v=>v.id===id(input.incidentId,'incident ID'));if(!incident)problem('Choose an original incident in that capture.');
  const from=utc(input.from,'exclusion start'),through=utc(input.through,'exclusion end');
  if(from<incident.openedAt||through<=from||through>capture.snapshot.capturedAt)problem('Choose an exclusion inside the retained incident timeline through its actual capture.');
  if(!['response','recovery','both'].includes(input.scope))problem('Choose the response clock, recovery clock or both.');
  return {schema:'stellar-forge.merchant-service-exclusion.v1',id:id(input.id),incidentId:incident.id,
    captureSha256:capture.sha256,incidentSourceId:capture.snapshot.source.id,merchantId:incident.merchantId,merchantBinding:incident.binding,
    from,through,scope:input.scope,reason:text(input.reason,'exclusion reason',4000),reference:text(input.reference,'reviewed exclusion reference',4000),
    reviewedBy:text(input.reviewedBy,'exclusion reviewer',240),createdAt};
}
function exclusionInput(value){return Object.fromEntries(['id','incidentId','captureSha256','from','through','scope','reason','reference','reviewedBy'].map(k=>[k,value[k]]));}
function normalizeSelection(input){
  fields(input,['termsId','termsRevision','from','through','asOf','captureSha256s','exclusionIds'],'report selection');
  const from=date(input.from,'period start'),through=date(input.through,'period end');
  if(through<from||Date.parse(through)-Date.parse(from)>366*DAY)problem('Choose an operating period of 367 days or less.');
  const captureSha256s=list(input.captureSha256s,'selected source captures',1000).map(v=>digest(v)).sort(),exclusionIds=list(input.exclusionIds??[],'selected exclusions',1000).map(v=>id(v)).sort();
  if(!captureSha256s.length||new Set(captureSha256s).size!==captureSha256s.length||new Set(exclusionIds).size!==exclusionIds.length)problem('Choose distinct retained captures and exclusions.');
  return {termsId:id(input.termsId,'terms ID'),termsRevision:integer(input.termsRevision,'terms revision',1),from,through,asOf:utc(input.asOf,'report cutoff'),captureSha256s,exclusionIds};
}
function compatibleIncidents(old,next){
  for(const key of ['id','merchantId','binding','kind','openedAt'])if(old[key]!==next[key])problem('Selected captures disagree on original incident '+old.id+'.');
  if(old.acknowledgment&&next.acknowledgment&&json(old.acknowledgment)!==json(next.acknowledgment))problem('Selected captures disagree on the original acknowledgment.');
  if(old.closedAt&&next.closedAt&&(old.closedAt!==next.closedAt||old.status!==next.status))problem('Selected captures disagree on the original incident close.');
}
function latestIncidents(captures){
  const found=new Map();
  for(const capture of [...captures].sort((a,b)=>a.snapshot.capturedAt.localeCompare(b.snapshot.capturedAt)||a.snapshot.revision-b.snapshot.revision||a.sha256.localeCompare(b.sha256))){
    for(const incident of capture.snapshot.incidents){
      const key=capture.snapshot.source.id+'|'+incident.merchantId+'|'+incident.id,old=found.get(key);
      if(old){compatibleIncidents(old.incident,incident);if(incident.revision<old.incident.revision)problem('A newer selected capture returns an older incident revision. Select the retained original chronology.');if(old.incident.acknowledgment&&!incident.acknowledgment||old.incident.closedAt&&!incident.closedAt)problem('A later source capture removes an original incident transition.');}
      found.set(key,{incident,sourceId:capture.snapshot.source.id,captureSha256:capture.sha256,capturedAt:capture.snapshot.capturedAt});
    }
  }
  return [...found.values()];
}
function metric(openedAt,completedAt,asOf,targetMinutes,calendar,exclusions,retiredAt,terminalState='RETIRED'){
  const start=Date.parse(openedAt),cutoff=Date.parse(asOf),completion=completedAt&&completedAt<=asOf?completedAt:null;
  const retired=retiredAt&&retiredAt<=asOf?retiredAt:null,end=Date.parse(completion??retired??asOf);
  const schedule=serviceIntervals(start,Math.max(start,end),calendar),effective=subtract(schedule,exclusions);
  const elapsedMs=milliseconds(schedule),serviceMs=milliseconds(effective),targetMs=targetMinutes*MINUTE;
  const state=completion?(serviceMs<=targetMs?'MET':'MISSED'):serviceMs>targetMs?'MISSED':retired?terminalState:'OPEN';
  return {state,completedAt:completion,elapsedMinutes:Math.max(0,end-start)/MINUTE,calendarMinutes:elapsedMs/MINUTE,excludedMinutes:(elapsedMs-serviceMs)/MINUTE,
    serviceMinutes:serviceMs/MINUTE,targetMinutes,remainingMinutes:Math.max(0,(targetMs-serviceMs)/MINUTE),
    deadline:deadline(start,targetMs,calendar,exclusions),through:completion??retired??asOf};
}
async function buildPreview(record,input){
  const selection=normalizeSelection(input),terms=record.terms.find(v=>v.id===selection.termsId&&v.revision===selection.termsRevision);
  if(!terms)problem('Choose a retained terms edition.');
  const timeline=record.terms.filter(v=>v.id===terms.id&&v.revision<=terms.revision).sort((a,b)=>a.revision-b.revision);
  const captures=selection.captureSha256s.map(sha=>{const found=record.captures.find(v=>v.sha256===sha);if(!found)problem('A selected original capture is unavailable.');return found;});
  const exclusions=selection.exclusionIds.map(key=>{const found=record.exclusions.find(v=>v.id===key);if(!found)problem('A selected exclusion is unavailable.');return found;});
  const from=boundary(selection.from,'00:00',terms.calendar.timeZone,'start'),through=boundary(plusDate(selection.through,1),'00:00',terms.calendar.timeZone,'start'),asOf=Date.parse(selection.asOf);
  if(asOf<from)problem('The report cutoff precedes its operating period.');
  const effectiveEnd=Math.min(through,asOf),incidents=[],uncovered=[];
  for(const retained of latestIncidents(captures)){
    const incident=retained.incident,opened=Date.parse(incident.openedAt);
    const evaluatedAsOf=new Date(Math.min(asOf,Date.parse(retained.capturedAt))).toISOString();
    const terminalAt=incident.closedAt&&incident.closedAt<=evaluatedAsOf?Date.parse(incident.closedAt):null;
    if(opened>=effectiveEnd||terminalAt!==null&&terminalAt<from)continue;
    if(Date.parse(evaluatedAsOf)<from){uncovered.push({id:incident.id,kind:incident.kind,sourceId:retained.sourceId,merchantId:incident.merchantId,reason:'SOURCE_CAPTURE_PRECEDES_PERIOD',captureSha256:retained.captureSha256});continue;}
    // A later ended or rebound edition shadows the earlier open-ended edition.
    const governing=timeline.filter(t=>t.effectiveFrom<=incident.openedAt).sort((a,b)=>b.revision-a.revision)[0];
    const applicable=governing&&governing.incidentSourceId===retained.sourceId&&governing.merchantId===incident.merchantId&&governing.merchantBinding===incident.binding&&
      (!governing.effectiveUntil||incident.openedAt<governing.effectiveUntil)?governing:null;
    if(!applicable){uncovered.push({id:incident.id,kind:incident.kind,sourceId:retained.sourceId,merchantId:incident.merchantId,reason:'NO_APPLICABLE_TERMS_EDITION',captureSha256:retained.captureSha256});continue;}
    const target=applicable.targets.find(v=>v.kind===incident.kind);
    if(!target){uncovered.push({id:incident.id,kind:incident.kind,sourceId:retained.sourceId,merchantId:incident.merchantId,reason:'NO_TARGET_FOR_CONDITION',captureSha256:retained.captureSha256});continue;}
    const selectedExclusions=exclusions.filter(e=>e.incidentId===incident.id&&e.incidentSourceId===retained.sourceId&&e.merchantId===incident.merchantId&&e.merchantBinding===incident.binding);
    const periods=scope=>selectedExclusions.filter(e=>e.scope==='both'||e.scope===scope).map(e=>[Date.parse(e.from),Date.parse(e.through)]);
    const recoveryAt=incident.status==='RECOVERED'?incident.closedAt:null,retiredAt=incident.status==='RETIRED'?incident.closedAt:null;
    const response=metric(incident.openedAt,incident.acknowledgment?.at??null,evaluatedAsOf,target.responseMinutes,applicable.calendar,periods('response'),recoveryAt??retiredAt,recoveryAt?'UNACKNOWLEDGED':'RETIRED');
    const recovery=metric(incident.openedAt,recoveryAt,evaluatedAsOf,target.recoveryMinutes,applicable.calendar,periods('recovery'),retiredAt);
    const status=retiredAt&&retiredAt<=evaluatedAsOf?'RETIRED':recovery.completedAt?'RECOVERED':response.completedAt?'ACKNOWLEDGED':'OPEN';
    incidents.push({id:incident.id,kind:incident.kind,sourceId:retained.sourceId,merchantId:incident.merchantId,merchantLabel:incident.merchantLabel??incident.merchantId,
      merchantBinding:incident.binding,sourceRevision:incident.revision,captureSha256:retained.captureSha256,capturedAt:retained.capturedAt,
      termsId:applicable.id,termsRevision:applicable.revision,termsSha256:applicable.sha256,termsStatus:applicable.status,owner:applicable.owner,
      openedAt:incident.openedAt,evaluatedAsOf,acknowledgedAt:response.completedAt,acknowledgedBy:response.completedAt?incident.acknowledgment.by:null,
      recoveredAt:recovery.completedAt,retiredAt:status==='RETIRED'?retiredAt:null,retiredReason:status==='RETIRED'?incident.retiredReason??'REGISTRATION_RETIRED':null,
      status,response,recovery,exclusionIds:selectedExclusions.map(e=>e.id),original:clone(incident),
      followUp:status==='RETIRED'?'Review the retired registration and continuing customer service.':status==='RECOVERED'?'Review the completed recovery.':!response.completedAt?'Acknowledge and resolve the original incident.':'Resolve the original incident.'});
  }
  incidents.sort((a,b)=>a.openedAt.localeCompare(b.openedAt)||a.id.localeCompare(b.id));uncovered.sort((a,b)=>a.id.localeCompare(b.id));
  const used=new Set(incidents.flatMap(v=>v.exclusionIds)),unused=exclusions.filter(e=>!used.has(e.id)).map(e=>e.id);
  const counts=kind=>Object.fromEntries(['MET','MISSED','OPEN','RETIRED','UNACKNOWLEDGED'].map(state=>[state,incidents.filter(i=>i[kind].state===state).length]));
  const sourceCaptures=captures.map(c=>({sha256:c.sha256,source:clone(c.snapshot.source),merchant:clone(c.snapshot.merchant),capturedAt:c.snapshot.capturedAt,
    revision:c.snapshot.revision,configRevision:c.snapshot.configRevision,configHash:c.snapshot.configHash,retention:clone(c.snapshot.retention),incidentCount:c.snapshot.incidents.length}));
  const body={schema:'stellar-forge.merchant-service-preview.v1',selection,terms:clone(terms),termsEditions:clone(timeline),
    period:{from:new Date(from).toISOString(),throughExclusive:new Date(through).toISOString(),effectiveThrough:new Date(effectiveEnd).toISOString(),timeZone:terms.calendar.timeZone},
    summary:{incidents:incidents.length,open:incidents.filter(i=>['OPEN','ACKNOWLEDGED'].includes(i.status)).length,recovered:incidents.filter(i=>i.status==='RECOVERED').length,
      retired:incidents.filter(i=>i.status==='RETIRED').length,proposed:incidents.filter(i=>i.termsStatus==='proposed').length,
      response:counts('response'),recovery:counts('recovery'),uncovered:uncovered.length,unusedExclusions:unused.length},
    incidents,uncovered,sourceCaptures,exclusions:clone(exclusions),unusedExclusionIds:unused,
    basis:'Original retained SF93 incident opening, acknowledgment and recovery timestamps. Targets use the applicable retained terms edition and its service calendar. Incidents overlap the selected local reporting period; clocks run through the earlier of the explicit report cutoff and their actual selected source capture.'};
  return {...body,previewSha256:await serviceSha256(body)};
}
export async function validateServiceRecord(value){
  if(value==null)return createServiceRecord();
  fields(value,['schema','terms','captures','exclusions','reports','operations','draft'],'service case');if(value.schema!==SERVICE_SCHEMA)problem('Choose the original service case schema.');
  const record=clone(value);record.draft=draft(record.draft??{});withinSize(record);
  const versions=new Map(),captureIds=new Set(),exclusionIds=new Set(),reportIds=new Set();
  for(const terms of list(record.terms,'terms editions',1000)){
    await checkSeal(terms,'terms edition');utc(terms.createdAt,'terms saved time');integer(terms.revision,'terms revision',1);
    const normalized=normalizeTerms(termsInput(terms),terms.revision,terms.createdAt);
    if(json(normalized)!==json(Object.fromEntries(Object.entries(terms).filter(([k])=>!['sha256','requestSha256'].includes(k)))))problem('The retained terms edition has an invalid shape.');
    if(terms.revision!==(versions.get(terms.id)??0)+1)problem('The original terms edition history has a gap or duplicate.');
    if(await serviceSha256(termsInput(terms))!==terms.requestSha256)problem('The retained terms request changed.');
    versions.set(terms.id,terms.revision);
  }
  for(const capture of list(record.captures,'original captures',1000)){
    fields(capture,['schema','snapshot','sha256'],'retained capture');if(capture.schema!=='stellar-forge.merchant-service-capture.v1')problem('The retained incident capture schema differs.');
    normalizeSnapshot(capture.snapshot);await checkSeal(capture,'incident capture');if(captureIds.has(capture.sha256))problem('A retained source capture is duplicated.');captureIds.add(capture.sha256);
  }
  for(const exclusion of list(record.exclusions,'reviewed exclusions',1000)){
    await checkSeal(exclusion,'exclusion');utc(exclusion.createdAt,'exclusion review time');
    if(json(normalizeExclusion(exclusionInput(exclusion),record.captures,exclusion.createdAt))!==json(withoutSeal(exclusion)))problem('The retained exclusion differs from its original incident.');
    if(exclusionIds.has(exclusion.id))problem('An exclusion ID is duplicated.');exclusionIds.add(exclusion.id);
  }
  for(const report of list(record.reports,'saved reports',1000)){
    fields(report,['schema','id','createdAt','reviewedBy','note','requestSha256','preview','sha256'],'saved service report');
    if(report.schema!==SERVICE_REPORT_SCHEMA)problem('The saved report schema differs.');id(report.id,'report ID');utc(report.createdAt,'report saved time');text(report.reviewedBy,'report reviewer',240);text(report.note,'report note',8000,false);
    await checkSeal(report,'service report');if(reportIds.has(report.id))problem('A report ID is duplicated.');reportIds.add(report.id);
    const expected=await buildPreview(record,report.preview.selection);if(json(expected)!==json(report.preview))problem('The saved report differs from its complete original terms, captures and exclusions.');
    if(await serviceSha256({previewSha256:expected.previewSha256,reviewedBy:report.reviewedBy,note:report.note})!==report.requestSha256)problem('The saved report review request changed.');
  }
  const operationIds=new Set();
  for(const operation of list(record.operations??[],'operator changes',1000)){
    await validateOperation(record,operation);
    if(operationIds.has(operation.id))problem('An original operator request is duplicated.');
    operationIds.add(operation.id);
  }
  return record;
}
function operationResult(record,operation){
  const ref=operation.result;
  fields(ref,['kind','sha256'],'operator result');
  if(!['terms','capture','exclusion','report'].includes(ref.kind))problem('Unknown original operator result.');
  const collection={terms:'terms',capture:'captures',exclusion:'exclusions',report:'reports'}[ref.kind];
  const result=record[collection].find(value=>value.sha256===digest(ref.sha256,'operator result hash'));
  if(!result)problem('An operator change is missing its original retained result.');
  return result;
}
function validateOperationBinding(record,operation,result){
  const request=operation.request;
  fields(request,['id','expectedRevision','requestId','action','input'],'operator request');
  id(request.id,'operator case ID');digest(request.expectedRevision,'operator case revision');
  if(id(request.requestId,'operator request ID')!==operation.id)
    problem('The retained operator request belongs to another request ID.');
  if(request.action!==operation.result.kind)
    problem('The retained operator action differs from its original result.');
  object(request.input,'operator change input');
  const input=request.input;
  if(request.action==='terms'){
    const expected=result.revision===1?null:result.revision-1;
    if(input.expectedRevision!==expected)problem('The retained terms request selects another original edition.');
    const normalized=normalizeTerms(input,result.revision,result.createdAt);
    const retained=Object.fromEntries(Object.entries(result).filter(([key])=>!['sha256','requestSha256'].includes(key)));
    if(json(normalized)!==json(retained))
      problem('The retained terms request differs from its original saved edition.');
  }else if(request.action==='capture'){
    fields(input,['incidentSource','merchantId','expectedSourceRevision','expectedConfigHash','expectedMerchantBinding'],'operator incident capture');
    const snapshot=result.snapshot;
    if(Object.hasOwn(input,'incidentSource')&&alias(input.incidentSource,'declared incident source')!==snapshot.source.id||
      alias(input.merchantId,'merchant')!==snapshot.merchant.id||
      integer(input.expectedSourceRevision,'source revision',1)!==snapshot.revision||
      digest(input.expectedConfigHash,'configuration hash')!==snapshot.configHash||
      digest(input.expectedMerchantBinding,'merchant binding')!==snapshot.merchant.binding)
      problem('The retained capture request differs from its original source, configuration or merchant.');
  }else if(request.action==='exclusion'){
    const normalized=normalizeExclusion(input,record.captures,result.createdAt);
    if(json(normalized)!==json(withoutSeal(result)))
      problem('The retained exclusion request differs from its original reviewed interval.');
  }else if(request.action==='report'){
    fields(input,['termsId','termsRevision','from','through','asOf','captureSha256s','exclusionIds',
      'expectedPreviewSha256','reviewedBy','note'],'operator report review');
    const selection=normalizeSelection(Object.fromEntries(['termsId','termsRevision','from','through',
      'asOf','captureSha256s','exclusionIds'].map(key=>[key,input[key]??(key==='exclusionIds'?[]:undefined)])));
    if(json(selection)!==json(result.preview.selection)||
      digest(input.expectedPreviewSha256,'reviewed preview hash')!==result.preview.previewSha256||
      text(input.reviewedBy,'report reviewer',240)!==result.reviewedBy||
      text(input.note??'','report note',8000,false)!==result.note)
      problem('The retained report request differs from its original reviewed selection or author.');
  }
}
async function validateOperation(record,operation){
  fields(operation,['schema','id','createdAt','request','requestSha256','result','sha256'],'operator change');
  if(operation.schema!=='stellar-forge.merchant-service-operation.v1')problem('The original operator change schema differs.');
  id(operation.id,'operator request ID');utc(operation.createdAt,'operator change time');
  object(operation.request,'operator request');
  if(enc.encode(json(operation.request)).length>131072)problem('The original operator request is too large.');
  if(await serviceSha256(operation.request)!==digest(operation.requestSha256,'operator request hash'))problem('The retained operator request changed.');
  await checkSeal(operation,'operator change');
  validateOperationBinding(record,operation,operationResult(record,operation));
}
export async function retainServiceOperation(value,{id:requestId,request,result}){
  const record=await validateServiceRecord(value);id(requestId,'operator request ID');
  object(request,'operator request');const requestSha256=await serviceSha256(request);
  const existing=(record.operations??[]).find(row=>row.id===requestId);
  if(existing){
    if(existing.requestSha256!==requestSha256)throw fail('SERVICE_OPERATION_CONFLICT','This original request ID belongs to different changes.');
    return {record,operation:clone(existing),result:clone(operationResult(record,existing)),reused:true};
  }
  const operation=await seal({schema:'stellar-forge.merchant-service-operation.v1',id:requestId,
    createdAt:new Date().toISOString(),request:clone(request),requestSha256,result:clone(result)});
  await validateOperation(record,operation);
  record.operations??=[];record.operations.push(operation);
  return {record:withinSize(record),operation:clone(operation),result:clone(operationResult(record,operation)),reused:false};
}
export async function saveServiceTerms(value,input){
  const record=await validateServiceRecord(value);id(input.id);const previous=record.terms.filter(t=>t.id===input.id).at(-1);
  const expected=input.expectedRevision;if(expected!==null)integer(expected,'expected terms revision',1);
  const revision=(expected??0)+1,createdAt=new Date().toISOString(),normalized=normalizeTerms(input,revision,createdAt),requestSha256=await serviceSha256(termsInput(normalized));
  const existing=record.terms.find(t=>t.id===input.id&&t.revision===revision);
  if(existing?.requestSha256===requestSha256)return {record,terms:clone(existing),reused:true};
  if((previous?.revision??null)!==expected)throw fail('SERVICE_TERMS_CONFLICT','The original terms have a later edition. Open that edition before saving these changes.');
  const terms=await seal({...normalized,requestSha256});record.terms.push(terms);return {record:withinSize(record),terms:clone(terms),reused:false};
}
export async function retainServiceSnapshot(value,input){
  const record=await validateServiceRecord(value),snapshot=normalizeSnapshot(input),capture=await seal({schema:'stellar-forge.merchant-service-capture.v1',snapshot});
  const existing=record.captures.find(c=>c.sha256===capture.sha256);if(existing)return {record,capture:clone(existing),reused:true};
  record.captures.push(capture);return {record:withinSize(record),capture:clone(capture),reused:false};
}
export async function saveServiceExclusion(value,input){
  const record=await validateServiceRecord(value),existing=record.exclusions.find(e=>e.id===input.id),normalized=normalizeExclusion(input,record.captures,existing?.createdAt??new Date().toISOString());
  if(existing){if(json(withoutSeal(existing))!==json(normalized))throw fail('SERVICE_EXCLUSION_CONFLICT','This review ID belongs to an earlier exclusion. Record a new reviewed choice.');return {record,exclusion:clone(existing),reused:true};}
  const exclusion=await seal(normalized);record.exclusions.push(exclusion);return {record:withinSize(record),exclusion:clone(exclusion),reused:false};
}
export async function previewServiceReport(value,selection){return buildPreview(await validateServiceRecord(value),selection);}
export async function retainServiceReport(value,input){
  const record=await validateServiceRecord(value);fields(input,['termsId','termsRevision','from','through','asOf','captureSha256s','exclusionIds','expectedPreviewSha256','reviewedBy','note'],'report review');
  const selection=Object.fromEntries(['termsId','termsRevision','from','through','asOf','captureSha256s','exclusionIds'].map(k=>[k,input[k]??(k==='exclusionIds'?[]:undefined)]));
  const preview=await buildPreview(record,selection);if(preview.previewSha256!==input.expectedPreviewSha256)throw fail('SERVICE_REPORT_CHANGED','Review the currently selected complete report before retaining it.');
  const reviewedBy=text(input.reviewedBy,'report reviewer',240),note=text(input.note??'','report note',8000,false),requestSha256=await serviceSha256({previewSha256:preview.previewSha256,reviewedBy,note});
  const existing=record.reports.find(r=>r.requestSha256===requestSha256);if(existing)return {record,report:clone(existing),reused:true};
  const report=await seal({schema:SERVICE_REPORT_SCHEMA,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reviewedBy,note,requestSha256,preview});record.reports.push(report);return {record:withinSize(record),report:clone(report),reused:false};
}
const escaped=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const minutes=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
function reportPreview(report){return report?.schema===SERVICE_REPORT_SCHEMA?report.preview:report;}
export function serviceReportCsv(report){
  const p=reportPreview(report);if(!p?.incidents)problem('Choose a complete service report.');
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['incident_id','source','merchant','condition','status','opened_at','acknowledged_at','acknowledged_by','recovered_at','retired_at','terms_revision','terms_status','response_target_minutes','response_service_minutes','response_excluded_minutes','response_result','response_deadline','recovery_target_minutes','recovery_service_minutes','recovery_excluded_minutes','recovery_result','recovery_deadline','owner','follow_up','source_capture_sha256']];
  for(const i of p.incidents)rows.push([i.id,i.sourceId,i.merchantId,i.kind,i.status,i.openedAt,i.acknowledgedAt,i.acknowledgedBy,i.recoveredAt,i.retiredAt,i.termsRevision,i.termsStatus,i.response.targetMinutes,i.response.serviceMinutes,i.response.excludedMinutes,i.response.state,i.response.deadline,i.recovery.targetMinutes,i.recovery.serviceMinutes,i.recovery.excludedMinutes,i.recovery.state,i.recovery.deadline,i.owner,i.followUp,i.captureSha256]);
  return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function renderServiceReport(report){
  const p=reportPreview(report);if(!p?.incidents)problem('Choose a complete service report.');
  const e=escaped,table=(heads,rows)=>'<table><thead><tr>'+heads.map(h=>'<th>'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+e(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  let body='<h1>'+e(p.terms.title)+'</h1><p>'+e(p.terms.customer)+' · '+e(p.selection.from)+' through '+e(p.selection.through)+' · '+e(p.period.timeZone)+'</p><p>Report cutoff: '+e(p.selection.asOf)+'. Owner: '+e(p.terms.owner)+'. Selected terms edition: '+p.terms.revision+' ('+e(p.terms.status)+').</p>';
  body+='<h2>Operating position</h2>'+table(['Observed incidents','Open follow-up','Recovered','Retired registrations','Outside selected terms'],[[p.summary.incidents,p.summary.open,p.summary.recovered,p.summary.retired,p.summary.uncovered]]);
  body+=table(['Clock','Met','Missed','Open within target','Retired','Recovered without acknowledgment'],[['Response',...['MET','MISSED','OPEN','RETIRED','UNACKNOWLEDGED'].map(k=>p.summary.response[k])],['Recovery',...['MET','MISSED','OPEN','RETIRED','UNACKNOWLEDGED'].map(k=>p.summary.recovery[k])]]);
  body+='<h2>Original incident timeline</h2>'+table(['Incident / condition','Opened','Acknowledged','Recovered / retired','Service response / target','Service recovery / target','Owner and follow-up'],p.incidents.map(i=>[i.id+'\n'+i.kind+'\n'+i.status,i.openedAt,i.acknowledgedAt?i.acknowledgedAt+'\n'+i.acknowledgedBy:'Open',i.recoveredAt??i.retiredAt??'Open',minutes(i.response.serviceMinutes)+' / '+i.response.targetMinutes+' min\n'+i.response.state,minutes(i.recovery.serviceMinutes)+' / '+i.recovery.targetMinutes+' min\n'+i.recovery.state,i.owner+'\n'+i.followUp]));
  body+='<h2>Terms and calendar editions</h2>'+table(['Edition','Effective interval','Status / reference','Calendar','Reviewer'],p.termsEditions.map(t=>[t.revision,t.effectiveFrom+' to '+(t.effectiveUntil??'open'),t.status+'\n'+t.reference,t.calendar.mode+'\n'+t.calendar.timeZone+'\n'+json({week:t.calendar.week,exceptions:t.calendar.exceptions}),t.reviewedBy]));
  body+='<h2>Reviewed exclusions</h2>'+table(['Incident','Interval / clock','Reason','Reference / reviewer'],p.exclusions.map(x=>[x.incidentId,x.from+' to '+x.through+'\n'+x.scope,x.reason,x.reference+'\n'+x.reviewedBy]));
  body+='<h2>Original retained sources</h2>'+table(['Source / merchant','Captured','Original revision','Source identity','Incidents'],p.sourceCaptures.map(c=>[c.source.label+'\n'+c.merchant.label,c.capturedAt,c.revision,c.sha256,c.incidentCount]));
  if(p.uncovered.length)body+='<h2>Additional source incidents</h2>'+table(['Incident','Condition','Source','Selection'],p.uncovered.map(i=>[i.id,i.kind,i.sourceId,i.reason]));
  body+='<p>'+e(p.basis)+'</p>';
  if(report.schema===SERVICE_REPORT_SCHEMA)body+='<h2>Saved review</h2><p>'+e(report.reviewedBy)+' · '+e(report.createdAt)+'</p><p>'+e(report.note)+'</p><p>Report '+e(report.id)+' · '+e(report.sha256)+'</p>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(p.terms.title)+' — operating report</title><style>body{font:14px/1.5 system-ui;color:#222;background:#fff;max-width:1280px;margin:32px auto;padding:0 24px}h1{font-size:25px}h2{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%;margin:12px 0 22px}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}@media print{body{margin:0;padding:0}tr{break-inside:avoid}}</style></head><body>'+body+'</body></html>';
}

/** Keep immutable service work when an older case, client or received workspace is saved. */
export async function mergeServiceHistory(value,retained){
  if(value==null)return retained==null?undefined:validateServiceRecord(retained);
  const incoming=await validateServiceRecord(value);
  if(retained==null)return incoming;
  const old=await validateServiceRecord(retained),result=clone(incoming);
  const keys={terms:row=>row.id+':'+row.revision,captures:row=>row.sha256,
    exclusions:row=>row.id,reports:row=>row.id,operations:row=>row.id};
  for(const [name,key] of Object.entries(keys)){
    if(name==='operations'&&old.operations===undefined&&incoming.operations===undefined)continue;
    const rows=new Map((old[name]??[]).map(row=>[key(row),clone(row)]));
    for(const row of incoming[name]??[]){
      const existing=rows.get(key(row));
      if(existing&&existing.sha256!==row.sha256)throw fail('SERVICE_HISTORY_CONFLICT','A retained '+name+' record differs from this original case history.');
      if(!existing)rows.set(key(row),clone(row));
    }
    result[name]=[...rows.values()];
    if(name==='terms')result[name].sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);
  }
  return validateServiceRecord(withinSize(result));
}
export function serviceSummary(record){
  if(!record)return null;
  return {agreements:new Set(record.terms.map(row=>row.id)).size,termsEditions:record.terms.length,
    captures:record.captures.length,exclusions:record.exclusions.length,reports:record.reports.length,
    operatorChanges:(record.operations??[]).length};
}
