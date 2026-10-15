'use strict';
/** Published route and DNS evidence. No network, SMTP, send or ledger mutation. */
const bytes=require('../runtime/host/connected_archive_bytes.cjs');
const sha=require('../runtime/host/connected_sha256.cjs');
const portable=require('../runtime/tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs');
const SCHEMA='commons.contact-route-triage.v1';
const json=x=>JSON.stringify(x);
const fail=m=>{throw new TypeError(m);};
const text=(x,label)=>typeof x==='string'&&x.trim()?x:fail(label+' must be nonempty text.');
const instant=(x,label)=>typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?x:fail(label+' needs an explicit timestamp/offset.');
const list=(x,label)=>Array.isArray(x)?x:fail(label+' must be an array.');
function createContactRouteTriage(options={}){
 const encode=options.encode||bytes.utf8;
 const hash=options.hash||(s=>sha.sha256Bytes(typeof s==='string'?encode(s):s).sha256);
 const seal=x=>({...x,sha256:hash(json(x))});
 const identity=s=>({bytes:encode(s).length,sha256:hash(s)});
 function domain(raw){
  if(typeof raw!=='string')return null;
  let s=raw.endsWith('.')?raw.slice(0,-1):raw;
  if(/[^\x00-\x7f]/.test(s)){
   if(typeof options.domainToASCII!=='function')return null;
   s=options.domainToASCII(s);
  }
  if(typeof s!=='string'||s.length>253||!s||s.split('.').some(x=>!x||x.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(x)))return null;
  return s.toLowerCase();
 }
 function address(raw){
  if(typeof raw!=='string'||raw!==raw.trim()||/[\s<>()\[\]\\",:;]/.test(raw))return null;
  const at=raw.lastIndexOf('@'),local=raw.slice(0,at),host=domain(raw.slice(at+1));
  if(at<1||!host||local.length>64||!/^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return null;
  return {original:raw,local,domain:host,key:local+'@'+host};
 }
 function entities(s){return s.replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi,(all,num,named)=>{
  if(num){const n=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):all;}
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",commat:'@',period:'.',colon:':',sol:'/','nbsp':' '})[named.toLowerCase()]??all;
 });}
 function decodeCloudflare(hex){
  if(typeof hex!=='string'||!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)||hex.length>4096)fail('Invalid Cloudflare hex evidence.');
  const key=parseInt(hex.slice(0,2),16),arr=[];
  for(let i=2;i<hex.length;i+=2)arr.push(parseInt(hex.slice(i,i+2),16)^key);
  // decodeURIComponent provides strict UTF-8 validation instead of replacing bad bytes.
  try{return decodeURIComponent(arr.map(n=>'%'+n.toString(16).padStart(2,'0')).join(''));}catch{fail('Cloudflare decoded bytes are not UTF-8.');}
 }
 function source(s){
  if(!s||typeof s!=='object')fail('Source required.');
  text(s.id,'Source id');text(s.url,'Original source URL');
  if(s.retrievedAt!==null&&s.retrievedAt!==undefined)instant(s.retrievedAt,'Source retrievedAt');
  else if(typeof s.retrievedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.retrievedDate)||!Number.isFinite(Date.parse(s.retrievedDate)))fail('Source needs observed retrievedAt or date-only retrievedDate; never invent a time.');
  if(!/^https?:\/\/[^/\s]+(?:\/|$)/i.test(s.url))fail('Source URL must be explicit HTTP(S).');
  if(typeof s.body!=='string'||encode(s.body).length>20*1024*1024)fail('Retain a complete UTF-8 source body within 20 MiB.');
  return {id:s.id,url:s.url,retrievedAt:s.retrievedAt??null,...(s.retrievedDate?{retrievedDate:s.retrievedDate}:{}),format:s.format,...identity(s.body)};
 }
 function emails(s){return [...s.matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?/g)].map(m=>address(m[0])).filter(Boolean);}
 function extractPublishedRoutes(s){
  const original=source(s);
  if(!['html','text'].includes(s.format))fail('Contact source format must be html or text.');
  const candidates=[],issues=[];
  function add(raw,kind,start,end,context,extra={}){
   const a=address(raw);
   if(!a){issues.push({code:'UNSUPPORTED_ADDRESS',kind,start,end,raw});return;}
   const row={kind,address:a.original,addressKey:a.key,domain:a.domain,sourceId:s.id,sourceSha256:original.sha256,
    start,end,offsetUnit:'UTF-16 code units',evidence:s.body.slice(start,end),context:context.slice(0,800),...extra};
   row.id='route-'+hash(json(row)).slice(0,32);candidates.push(row);
  }
  function mailto(v,start,end,context,extra){
   try{
    const decoded=decodeURIComponent(v.replace(/^mailto:/i,'').split('?')[0]);
    for(const a of decoded.split(','))add(a,'mailto',start,end,context,extra);
   }catch{issues.push({code:'INVALID_MAILTO_ENCODING',start,end});}
  }
  const blank=t=>t.replace(/[^\r\n]/g,' ');
  const safe=s.format==='html'?s.body.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,blank):s.body;
  if(s.format==='html'){
   // Deliberately conservative extraction, not a browser DOM or visibility proof.
   for(const m of safe.matchAll(/<[A-Za-z][^>]*>/g)){
    const tag=m[0],start=m.index,end=start+tag.length;
    const attrs={};
    for(const a of tag.matchAll(/([^\s"'=<>\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g))attrs[a[1].toLowerCase()]=entities(a[2]??a[3]??a[4]);
    const href=attrs.href;
    const context=s.body.slice(Math.max(0,start-120),Math.min(s.body.length,end+300));
    const hidden=/\bhidden(?:\s|=|>)/i.test(tag)||attrs['aria-hidden']==='true'||/display\s*:\s*none/i.test(attrs.style||'');
    if(hidden)continue;
    if(href&&/^mailto:/i.test(href))mailto(href,start,end,context,{href});
    const cf=attrs['data-cfemail']||(href&&href.match(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i)?.[1]);
    if(cf){try{
     const decoded=decodeCloudflare(cf);
     add(decoded.split('?')[0],'cloudflare',start,end,context,{encoded:cf,decoded});
    }catch(e){issues.push({code:'INVALID_CLOUDFLARE',start,end,message:e.message});}}
   }
   for(const a of safe.matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)){
    const head=a[0].match(/^<a\b[^>]*>/i)[0],href=head.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if(!href)continue;
    const h=entities(href[1]??href[2]),visible=emails(entities(a[0].replace(/<[^>]*>/g,' ')));
    let target=[];
    try{if(/^mailto:/i.test(h))target=emails(decodeURIComponent(h.slice(7).split('?')[0]));else{const c=h.match(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i);if(c)target=emails(decodeCloudflare(c[1]).split('?')[0]);}}catch{}
    if(visible.length&&target.length&&visible.some(v=>!target.some(t=>t.key===v.key))){
     issues.push({code:'VISIBLE_TARGET_MISMATCH',start:a.index,end:a.index+a[0].length,visible:visible.map(v=>v.original),target:target.map(t=>t.original)});
    }
   }
   for(const m of safe.matchAll(/(?:^|>)([^<]+)(?=<|$)/g)){
    const start=m.index+(m[0][0]==='>'?1:0),end=start+m[1].length;
    for(const a of emails(entities(m[1])))add(a.original,'visible_text',start,end,entities(m[1]));
   }
  }else for(const m of s.body.matchAll(/[^\r\n]+/g))for(const a of emails(m[0]))add(a.original,'visible_text',m.index,m.index+m[0].length,m[0]);
  for(const c of candidates)c.reviewFlags=[
   'BUSINESS_IDENTITY_AND_PURPOSE_UNCONFIRMED',
   ...(s.format==='html'?['RENDERED_VISIBILITY_UNCONFIRMED']:[]),
   ...issues.filter(x=>x.code==='VISIBLE_TARGET_MISMATCH'&&c.start>=x.start&&c.end<=x.end).map(x=>x.code),
   ...(/\b(?:for example|sample (?:email|address)|placeholder)\b/i.test(c.context)?['EXAMPLE_CONTEXT']:[]),
   ...(/^\+?\d[\d-]{5,}[A-Za-z]/.test(c.address)?['POSSIBLE_CAPTURE_CONCATENATION']:[])
  ];
  return seal({schema:SCHEMA+'.extraction',source:original,candidates,issues});
 }
 function interpretDNS(s){
  const original=source(s),host=domain(s.domain),type=typeof s.type==='string'?({MX:15,A:1,AAAA:28})[s.type]:s.type;
  if(s.format!=='dns-json'||!host||![1,15,28].includes(type))fail('DNS source needs domain, MX/A/AAAA type and dns-json format.');
  let d;try{d=JSON.parse(s.body);}catch{d=null;}
  const base={schema:SCHEMA+'.dns',source:original,domain:host,type,status:d?.Status??null,
   mailboxVerified:false,records:[],chain:[],issues:[],dnssecValidated:d?.AD===true,checkingDisabled:d?.CD===true};
  const done=(state,notes)=>seal({...base,state,notes});
  if(!d||!Number.isInteger(d.Status)||d.Status<0||d.Status>4095||!Array.isArray(d.Question)||d.Question.length!==1)
   return done('INVALID_RESPONSE','No complete supported DNS JSON response/question.');
  if(domain(d.Question[0].name)!==host||d.Question[0].type!==type)return done('QUESTION_MISMATCH','Response is not bound to the requested domain and type.');
  if(d.TC===true)return done('TRUNCATED','Retain a complete response before interpreting the answer.');
  if(d.Status===2)return done('SERVFAIL','Resolver failure; does not establish domain absence.');
  if(d.Status===5)return done('REFUSED','Resolver refused this request; domain state unknown.');
  if(![0,3].includes(d.Status))return done('DNS_ERROR','Other DNS response code; retained without a deliverability conclusion.');
  if(d.Answer!==undefined&&!Array.isArray(d.Answer))return done('INVALID_RESPONSE','Answer must be an array when present.');
  const answers=d.Answer||[];
  if(answers.some(r=>!r||typeof r!=='object'||!domain(r.name)||!Number.isInteger(r.type)||typeof r.data!=='string'||!Number.isInteger(r.TTL)||r.TTL<0))return done('INVALID_RESPONSE','Malformed DNS answer record.');
  let current=host;const seen=new Set();
  for(let i=0;i<32;i++){
   if(seen.has(current))return done('INCONSISTENT','CNAME cycle.');seen.add(current);
   const owned=answers.filter(r=>domain(r?.name)===current);
   const aliases=owned.filter(r=>r.type===5),rr=owned.filter(r=>r.type===type);
   if(aliases.length){
    if(rr.length||new Set(aliases.map(r=>domain(r.data))).size!==1||!domain(aliases[0].data))
     return done('INCONSISTENT','Conflicting CNAME/answer records.');
    base.chain.push({from:current,to:domain(aliases[0].data)});current=domain(aliases[0].data);continue;
   }
   base.canonicalName=current;
   const unrelated=answers.filter(r=>r.type===type&&!seen.has(domain(r.name)));
   if(unrelated.length)base.issues.push({code:'UNRELATED_ANSWER_IGNORED',count:unrelated.length});
   if(d.Status===3){
    if(rr.length)return done('INCONSISTENT','NXDOMAIN contradicts answer records.');
    return done('NXDOMAIN',base.chain.length?'The CNAME target is reported nonexistent; the original alias may exist.':'Resolver reports the requested name does not exist.');
   }
   if(!rr.length)return done(type===15?'NO_MX':'NO_ADDRESS',type===15?'No MX in this response. SMTP implicit A/AAAA fallback remains possible.':'No address of the requested family in this response.');
   if(rr.some(r=>typeof r.data!=='string'||!Number.isInteger(r.TTL)||r.TTL<0))return done('INVALID_RESPONSE','Malformed answer data/TTL.');
   if(type===15){
    const mx=rr.map(r=>{const m=r.data.match(/^(\d+)\s+(\S+)$/);return m&&Number(m[1])<=65535&&(m[2]==='.'||domain(m[2]))?{preference:Number(m[1]),exchange:m[2]==='.'?'.':domain(m[2]),ttl:r.TTL}:null;});
    if(mx.some(x=>!x))return done('INVALID_MX','Malformed MX data.');
    base.records=mx;
    if(mx.some(r=>r.exchange==='.')){
     if(mx.length===1&&mx[0].preference===0)return done('NULL_MX','Single 0 . explicitly advertises no mail service.');
     return done('INCONSISTENT','Null MX mixed with other records or nonzero preference violates the null-MX contract.');
    }
    base.records.sort((a,b)=>a.preference-b.preference||a.exchange.localeCompare(b.exchange));
    return done('MX_PUBLISHED','Routing records published; exchanger reachability and recipient mailbox remain unverified.');
   }
   const valid4=x=>/^\d+\.\d+\.\d+\.\d+$/.test(x)&&x.split('.').every(y=>Number(y)<=255&&String(Number(y))===y);
   const valid6=x=>{
    if(!/^[0-9a-f:]+$/i.test(x)||!x.includes(':')||(x.match(/::/g)||[]).length>1)return false;
    const p=x.split('::'),a=p.flatMap(y=>y?y.split(':'):[]);
    return a.every(y=>/^[0-9a-f]{1,4}$/i.test(y))&&(p.length===2?a.length<8:a.length===8);
   };
   if(rr.some(r=>!(type===1?valid4:valid6)(r.data)))return done('INVALID_RESPONSE','Unsupported or malformed IP address text.');
   base.records=rr.map(r=>({address:r.data,ttl:r.TTL}));
   return done('ADDRESS_PUBLISHED','Address record only; SMTP service and recipient mailbox remain unverified.');
  }
  return done('INCONSISTENT','CNAME chain exceeds 32 hops.');
 }
 function summarizeDNS(host,rows){
  const mx=rows.filter(r=>r.domain===host&&r.type===15);
  if(!mx.length)return {state:'NOT_CHECKED',mailboxVerified:false,sourceIds:[],note:'No DNS witness supplied; this report does not impose a send gate.'};
  const states=[...new Set(mx.map(r=>json({state:r.state,canonicalName:r.canonicalName??null,records:r.records.map(x=>({preference:x.preference,exchange:x.exchange})).sort((a,b)=>json(a).localeCompare(json(b)))})))];
  if(states.length!==1)return {state:'DIFFERING_OBSERVATIONS',mailboxVerified:false,sourceIds:mx.map(r=>r.source.id),note:'Resolver/time observations differ; inspect each original rather than silently choose.'};
  const primary=mx[0],result={state:primary.state,mailboxVerified:false,sourceIds:mx.map(r=>r.source.id),note:primary.notes};
  if(primary.state!=='NO_MX')return result;
  const names=new Set(mx.map(r=>r.canonicalName||host));
  const addr=rows.filter(r=>[1,28].includes(r.type)&&(r.domain===host||names.has(r.domain)));
  result.sourceIds.push(...addr.map(r=>r.source.id));
  if(addr.some(r=>r.canonicalName&&!names.has(r.canonicalName))||[1,28].some(t=>new Set(addr.filter(r=>r.type===t).map(r=>r.state)).size>1))return {...result,state:'DIFFERING_OBSERVATIONS',note:'Address observations disagree with each other or the MX lookup alias target; inspect their original timestamps and chains.'};
  if(addr.some(r=>r.state==='ADDRESS_PUBLISHED'))return {...result,state:'NO_MX_ADDRESS_FALLBACK',note:'No MX, with a retained A/AAAA address. SMTP implicit-MX fallback is possible; service and mailbox remain unverified.'};
  const both=[1,28].every(t=>addr.some(r=>r.type===t&&r.state==='NO_ADDRESS'));
  return {...result,state:both?'NO_MX_NO_ADDRESS':'NO_MX_FALLBACK_UNKNOWN',note:both?'MX and both address families absent in supplied observations; check resolver/time consistency.':'No MX alone is not a no-mail conclusion; A/AAAA evidence is incomplete or uncertain.'};
 }
 function triage(input){
  if(!input||input.schema!==SCHEMA+'.input')fail('Use the contact-route-triage input schema.');
  text(input.caseReference,'Original case reference');instant(input.checkedAt,'checkedAt');
  const docs=list(input.documents,'documents'),dns=list(input.dns,'dns'),ids=new Set();
  for(const s of [...docs,...dns]){if(ids.has(s.id))fail('Duplicate source id.');ids.add(s.id);}
  const extractions=docs.map(extractPublishedRoutes),observations=dns.map(interpretDNS);
  const candidates=extractions.flatMap(r=>r.candidates),reviewed=list(input.reviews||[],'reviews');
  const reviews=new Map();
  for(const r of reviewed){
   if(reviews.has(r.candidateId)||!candidates.some(c=>c.id===r.candidateId))fail('Review needs one exact extracted candidate.');
   if(r.resolvedMismatchEvidence!==undefined)text(r.resolvedMismatchEvidence,'resolvedMismatchEvidence');
   text(r.reviewedBy,'reviewedBy');instant(r.reviewedAt,'reviewedAt');text(r.companyIdentityEvidence,'companyIdentityEvidence');text(r.businessPurpose,'businessPurpose');
   if(!['appropriate','unsuitable','uncertain'].includes(r.disposition))fail('Review disposition required.');
   reviews.set(r.candidateId,r);
  }
  let preview=null,events=[];
  if(input.feedback){
   // Recompute using the existing parser and original ledger/native evidence.
   // A caller-supplied diagnosis or hand-written feedback array is not accepted.
   const f=input.feedback,host=portable.createPortableGmail({domainToASCII:options.domainToASCII});
   if(!f.ledger||!f.input)fail('Feedback requires original ledger and original native input.');
   preview=host.feedback.previewLeadDeliveryFeedback(f.ledger,f.input);
   host.feedback.validateLeadDeliveryFeedbackPreview(f.ledger,f.input,preview);
   const selected=list(f.selectedFeedbackIds,'selectedFeedbackIds');
   if(new Set(selected).size!==selected.length)fail('Duplicate selected feedback identity.');
   events=selected.map(id=>preview.feedback.find(x=>x.id===id)||fail('Selected feedback does not resolve through the maintained parser.'));
   if(preview.review.some(r=>r.requires_review!==false)||preview.unmatched.length)fail('Resolve original feedback review/unmatched sources in the maintained receiver first.');
  }
  const selectedCurrent=input.currentAddress===undefined?null:address(input.currentAddress);
  if(input.currentAddress!==undefined&&!selectedCurrent)fail('Unsupported currentAddress.');
  const prior=selectedCurrent?events.filter(e=>address(e.recipient)?.key===selectedCurrent.key):[];
  let recoveryState='NO_ACTUAL_FAILURE_SELECTED';
  if(prior.some(e=>e.action==='delayed'))recoveryState='ORIGINAL_ATTEMPT_RECONCILIATION';
  else if(prior.some(e=>['delivered','relayed','expanded'].includes(e.action)))recoveryState='EXISTING_OUTCOME_REVIEW';
  else if(prior.some(e=>e.action==='failed'&&e.terminal))recoveryState='ACTUAL_FAILURE_ROUTE_REVIEW';
  const routes=candidates.map(c=>{
   const r=reviews.get(c.id)||null,ownEvents=events.filter(e=>address(e.recipient)?.key===c.addressKey);
   let suitability=r?.disposition==='appropriate'?'PUBLISHED_ROUTE_REVIEWED':'PURPOSE_REVIEW_NEEDED';
   if(r?.disposition==='unsuitable')suitability='UNSUITABLE_PURPOSE';
   if(c.reviewFlags.includes('VISIBLE_TARGET_MISMATCH')&&!r?.resolvedMismatchEvidence)suitability='PUBLICATION_MISMATCH_UNRESOLVED';
   if(ownEvents.some(e=>e.action==='failed'&&e.terminal))suitability='ACTUAL_FAILED_ROUTE';
   if(ownEvents.some(e=>e.action==='delayed'))suitability='ORIGINAL_ATTEMPT_RECONCILIATION';
   return {...c,review:r,suitability,dns:summarizeDNS(c.domain,observations),actualFeedbackIds:ownEvents.map(e=>e.id),
    routingReviewRequired:['NXDOMAIN','NULL_MX','INCONSISTENT','NO_MX_NO_ADDRESS','DIFFERING_OBSERVATIONS'].includes(summarizeDNS(c.domain,observations).state),
    alternateCandidate:recoveryState==='ACTUAL_FAILURE_ROUTE_REVIEW'&&c.addressKey!==selectedCurrent?.key&&suitability==='PUBLISHED_ROUTE_REVIEWED',
    mailboxVerified:false};
  });
  return seal({schema:SCHEMA,caseReference:input.caseReference,checkedAt:input.checkedAt,inputSha256:hash(json(input)),
   extraction:extractions,dns:observations,routes,recovery:{state:recoveryState,currentAddress:input.currentAddress??null,
   selectedFeedback:events,availableFeedback:preview?preview.feedback.map(e=>({id:e.id,recipient:e.recipient,action:e.action,status:e.status,occurred_at:e.occurred_at,delivery_id:e.delivery_id})):[],correspondenceRefreshRequired:true,previewSha256:preview?hash(json(preview)):null},
   authority:'Evidence for the existing case owner. No send, form submission, mailbox verification, customer revision or authorization is performed.',
   sources:[...docs,...dns].map(source)});
 }
 function render(report){
  if(report.schema!==SCHEMA)fail('Unsupported report.');
  const lines=['# Published contact and DNS review','',report.caseReference,'','Checked: '+report.checkedAt,'',
   report.authority,'','## Actual delivery context','',report.recovery.state,'',
   ...report.recovery.selectedFeedback.map(e=>'- '+e.action+' '+e.status+' for '+e.recipient+'; original feedback '+e.id+
   (e.will_retry_until?'; provider retry-until '+e.will_retry_until:'')),
   '','## Published routes',''];
  for(const r of report.routes)lines.push('### '+r.address,'',r.suitability+'; DNS: '+r.dns.state+'. Mailbox outcome is not established by DNS.',
   '',r.dns.note,'','Source: '+report.sources.find(s=>s.id===r.sourceId).url,'','Evidence: '+JSON.stringify(r.evidence),
   '',r.review?'Reviewer: '+r.review.reviewedBy+'. Purpose: '+r.review.businessPurpose:'Business identity and purpose need review.',
   '',r.alternateCandidate?'Distinct published route for owner consideration after the selected actual failure. This does not authorize dispatch.':'No alternate dispatch decision made.','');
  lines.push('## Source retention','','The input preserves every supplied document and DNS JSON string. Offsets use UTF-16 code units; source hashes use UTF-8 bytes. Rendered visibility, business ownership and mailbox existence are not inferred.','','## Next action','','Use the original case owner and current correspondence. A delayed provider attempt needs reconciliation before a duplicate approach. Unknown DNS is informational, not a new permission rule. For an actual failed attempt, review a distinct published business route or an independently read public contact form; preserve the old recipient and actual failure.','');
  return lines.join('\n');
 }
 return {address,domain,decodeCloudflare,extractPublishedRoutes,interpretDNS,summarizeDNS,triage,render};
}
module.exports={SCHEMA,createContactRouteTriage};
