// SPDX-License-Identifier: MIT
(function(root,factory){const api=factory(function(bytes){const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],n=bytes.length,b=Array.from(bytes),bits=n*8;b.push(128);while(b.length%64!==56)b.push(0);for(let i=7;i>=0;i--)b.push(Math.floor(bits/2**(8*i))&255);const rr=(a,n)=>(a>>>n)|(a<<(32-n));for(let j=0;j<b.length;j+=64){const w=new Int32Array(64);for(let i=0;i<16;i++)w[i]=(b[j+4*i]<<24)|(b[j+4*i+1]<<16)|(b[j+4*i+2]<<8)|b[j+4*i+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=((rr(x,7)^rr(x,18)^(x>>>3))+w[i-16]+(rr(y,17)^rr(y,19)^(y>>>10))+w[i-7])|0}let [a,c,d,e,f,g,k,l]=h;for(let i=0;i<64;i++){const t1=(l+(rr(f,6)^rr(f,11)^rr(f,25))+((f&g)^(~f&k))+K[i]+w[i])|0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&c)^(a&d)^(c&d)))|0;l=k;k=g;g=f;f=(e+t1)|0;e=d;d=c;c=a;a=(t1+t2)|0}for(const [i,v]of[a,c,d,e,f,g,k,l].entries())h[i]=(h[i]+v)|0;}return h.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");});if(typeof module==="object"&&module.exports)module.exports=api;else root.StoveOperations=api;})(typeof globalThis!=="undefined"?globalThis:this,function stoveCoreFactory(sha){
'use strict';
const VERSION='1.0.0',SCHEMA='commons.stove-operations.v1',MAX_FILE=8*1024*1024,MAX_WORKSPACE=64*1024*1024;
const collections=['sites','appliances','enquiries','surveys','quotes','jobs','visits','fieldRecords','findings','payments','handovers','servicePlans','attachments','imports'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o),clone=o=>JSON.parse(JSON.stringify(o));
function need(ok,code){if(!ok){const e=new Error(code.replaceAll('_',' '));e.code=code;throw e;}}
function text(v,required=false,max=20000){need(typeof v==='string'&&v.length<=max,'INVALID_TEXT');need(!required||v.trim().length>0,'REQUIRED_TEXT');return v;}
function id(v){text(v,true,160);need(/^[A-Za-z0-9_.:-]+$/.test(v),'INVALID_ID');return v;}
function str(v){return v==null?'':text(v);}
function canonical(v){if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);if(typeof v==='number'){need(Number.isFinite(v)&&Number.isSafeInteger(v),'UNSAFE_NUMBER');return JSON.stringify(v);}if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';need(plain(v),'INVALID_VALUE');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function bytes(s){need(typeof s==='string','TEXT_REQUIRED');try{return Uint8Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0));}catch(e){need(false,'INVALID_UNICODE');}}
const hash=v=>sha(bytes(canonical(v)));
function decode(b){let out='';for(let i=0;i<b.length;i+=8192)out+=Array.from(b.slice(i,i+8192),v=>'%'+v.toString(16).padStart(2,'0')).join('');try{return decodeURIComponent(out);}catch(e){need(false,'INVALID_UTF8');}}
const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function unbase64(s){need(typeof s==='string'&&s.length%4===0&&s.length<=Math.ceil(MAX_FILE/3)*4,'INVALID_BASE64');if(!s.length)return new Uint8Array(0);const padding=s.endsWith('==')?2:s.endsWith('=')?1:0,length=s.length/4*3-padding;need(length<=MAX_FILE,'ATTACHMENT_TOO_LARGE');const out=new Uint8Array(length);let offset=0;for(let i=0;i<s.length;i+=4){const last=i+4===s.length,a=abc.indexOf(s[i]),b=abc.indexOf(s[i+1]),c=last&&padding===2?0:abc.indexOf(s[i+2]),d=last&&padding?0:abc.indexOf(s[i+3]);need(a>=0&&b>=0&&c>=0&&d>=0&&(!last||padding!==2||s[i+2]==='=')&&(!last||!padding||s[i+3]==='='),'INVALID_BASE64');if(last&&padding===2)need((b&15)===0,'NONCANONICAL_BASE64');if(last&&padding===1)need((c&3)===0,'NONCANONICAL_BASE64');const n=(a<<18)|(b<<12)|(c<<6)|d;if(offset<length)out[offset++]=n>>>16&255;if(offset<length)out[offset++]=n>>>8&255;if(offset<length)out[offset++]=n&255;}return out;}
function base64(b){let s='';for(let i=0;i<b.length;i+=3){const n=(b[i]<<16)|((b[i+1]??0)<<8)|(b[i+2]??0);s+=abc[n>>>18&63]+abc[n>>>12&63]+(i+1<b.length?abc[n>>>6&63]:'=')+(i+2<b.length?abc[n&63]:'=');}return s;}
function date(v,optional=false){if(optional&&!v)return '';text(v,true,10);need(/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'INVALID_DATE');return v;}
function instant(v,optional=false){if(optional&&!v)return '';text(v,true,60);need(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)),'EXPLICIT_TIMEZONE_REQUIRED');date(v.slice(0,10));return new Date(v).toISOString();}
function zone(v){if(!v)return '';text(v,true,100);try{new Intl.DateTimeFormat('en',{timeZone:v});}catch(e){need(false,'INVALID_TIMEZONE');}return v;}
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER){need(Number.isSafeInteger(v)&&v>=min&&v<=max,'INVALID_INTEGER');return v;}
function amount(v){return v===''||v==null?'':integer(v);}
function unique(a,fn=v=>v){need(Array.isArray(a),'ARRAY_REQUIRED');const s=new Set();for(const x of a){const k=fn(x);need(!s.has(k),'DUPLICATE_RECORD');s.add(k);}return a;}
function fields(r,allowed){need(plain(r),'RECORD_REQUIRED');for(const k of Object.keys(r))need(allowed.includes(k),'UNKNOWN_FIELD_'+k.toUpperCase());}
const ref=(w,c,k,optional=false)=>{if(optional&&!k)return null;id(k);const v=w[c].find(x=>x.id===k);need(v,c.toUpperCase()+'_NOT_FOUND');return v;};
function ids(w,a,c='attachments'){return unique(a??[]).map(k=>{ref(w,c,k);return k;});}
function links(w,r){const s=ref(w,'sites',r.siteId);if(r.applianceId)need(ref(w,'appliances',r.applianceId).siteId===s.id,'APPLIANCE_SITE_CHANGED');if(r.enquiryId)need(ref(w,'enquiries',r.enquiryId).siteId===s.id,'ENQUIRY_SITE_CHANGED');return s;}
function measurements(a){return unique(a??[],x=>x.id).map(x=>{fields(x,['id','label','value','unit','source']);return {id:id(x.id),label:text(x.label,true),value:str(x.value),unit:str(x.unit),source:str(x.source)};});}
function evidence(w,a,siteId,jobId){return ids(w,a).map(k=>{const f=ref(w,'attachments',k);need(!f.siteId||f.siteId===siteId,'EVIDENCE_SITE_CHANGED');need(!f.jobId||!jobId||f.jobId===jobId,'EVIDENCE_JOB_CHANGED');return k;});}
const uid=p=>(p||'record')+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))freeze(v);}return o;}
const trusted=new WeakSet();
function seal(w){const c={...w};delete c.sha256;w.sha256=hash(c);trusted.add(w);return freeze(w);}
function catalogueCheck(c){need(plain(c)&&typeof c.schema==='string'&&Array.isArray(c.operators)&&c.operators.length,'CATALOGUE_REQUIRED');unique(c.operators,o=>o.key);for(const o of c.operators){id(o.key);text(o.name,true);need(Array.isArray(o.sourceUrls)&&o.sourceUrls.every(u=>typeof u==='string'&&/^https:\/\//.test(u)),'SOURCE_URLS_REQUIRED');}canonical(c);return c;}
function create(c,options={}){catalogueCheck(c);const at=instant(options.createdAt??new Date().toISOString());const w={schema:SCHEMA,id:id(options.id??uid('stove')),title:text(options.title??'Stove survey-to-handover workspace',true),revision:0,createdAt:at,updatedAt:at,catalogueSha256:hash(c),catalogue:clone(c)};for(const k of collections)w[k]=[];w.history=[];return seal(w);}
function identity(w,r){return {site:clone(ref(w,'sites',r.siteId)),appliance:r.applianceId?clone(ref(w,'appliances',r.applianceId)):null};}
function issue(a,code,message){a.push({code,message});}
function reviewed(w,body){return {...body,revision:w.revision,reviewSha256:hash({workspaceId:w.id,revision:w.revision,catalogueSha256:w.catalogueSha256,body})};}
function reviewSurvey(w,k){const r=ref(w,'surveys',k),a=[];if(r.status!=='draft')issue(a,'NOT_DRAFT','This survey edition is already finalized.');if(!r.conductedAt||!r.author.trim()||!r.observations.trim())issue(a,'SURVEY_DETAILS_REQUIRED','Record the actual survey time, author and observations.');for(const c of r.checks)if(c.result==='unreviewed'||!c.notes.trim())issue(a,'SURVEY_CHECK_REQUIRED','Record the result and notes for '+c.label+'.');return reviewed(w,{id:k,issues:a,canFinalize:a.length===0});}
function quoteTotals(q){const a=[];let subtotal=0;for(const l of q.lines){if(l.quantityMilli===''||l.unitPriceCents===''){issue(a,'QUOTE_AMOUNT_REQUIRED','Enter the actual quantity and price for '+l.label+'.');continue;}const product=l.quantityMilli*l.unitPriceCents;need(Number.isSafeInteger(product)&&product<=Number.MAX_SAFE_INTEGER-500,'QUOTE_TOTAL_OVERFLOW');subtotal+=Math.floor((product+500)/1000);need(Number.isSafeInteger(subtotal),'QUOTE_TOTAL_OVERFLOW');}
 for(const k of ['discountCents','taxBasisPoints','depositCents'])if(q[k]==='')issue(a,'QUOTE_AMOUNT_REQUIRED','Enter '+k+' explicitly, including zero where intended.');
 if(!q.lines.length)issue(a,'QUOTE_LINES_REQUIRED','At least one priced line is required.');
 const discount=q.discountCents===''?0:q.discountCents,net=subtotal-discount;if(net<0)issue(a,'DISCOUNT_EXCEEDS_QUOTE','Discount exceeds the quoted subtotal.');
 const product=Math.max(0,net)*(q.taxBasisPoints===''?0:q.taxBasisPoints);need(Number.isSafeInteger(product)&&product<=Number.MAX_SAFE_INTEGER-5000,'QUOTE_TOTAL_OVERFLOW');const tax=Math.floor((product+5000)/10000),total=net+tax,deposit=q.depositCents===''?0:q.depositCents;need(Number.isSafeInteger(total),'QUOTE_TOTAL_OVERFLOW');if(deposit>total)issue(a,'DEPOSIT_EXCEEDS_QUOTE','Deposit exceeds the quote total.');
 return {issues:a,totals:{subtotalCents:subtotal,discountCents:discount,netCents:net,taxCents:tax,totalCents:total,depositCents:deposit,balanceCents:total-deposit}};}
function quoteView(w,k){const q=ref(w,'quotes',k),t=quoteTotals(q),a=t.issues.slice();if(!q.issuedOn||!q.validUntil||q.validUntil<q.issuedOn)issue(a,'QUOTE_DATES_REQUIRED','Choose issue and expiry dates in order.');if(!/^[A-Z]{3}$/.test(q.currency)||!q.scope.trim()||!q.terms.trim())issue(a,'QUOTE_TERMS_REQUIRED','Record currency, exact scope and terms.');if(q.status!=='draft')issue(a,'QUOTE_ALREADY_ISSUED','This quote content is frozen.');return {quote:q,totals:t.totals,issues:a,canIssue:a.length===0};}
function reviewQuote(w,k){const {quote,...v}=quoteView(w,k);return reviewed(w,{id:k,...v});}
function reviewVisit(w,k){const v=ref(w,'visits',k),j=ref(w,'jobs',v.jobId),a=[],conflicts=[];if(v.status!=='requested')issue(a,'VISIT_NOT_REQUESTED','Review a requested appointment.');if(['completed','cancelled'].includes(j.status))issue(a,'JOB_CLOSED','Create a linked follow-up for further work.');if(!v.startAt||!v.endAt||Date.parse(v.startAt)>=Date.parse(v.endAt)||!v.timezone||!v.workerRefs.length)issue(a,'VISIT_PLAN_REQUIRED','Choose an ordered interval, timezone and crew references.');
 if(v.startAt&&v.endAt)for(const o of w.visits){if(o.id===v.id||ref(w,'sites',ref(w,'jobs',o.jobId).siteId).operatorKey!==ref(w,'sites',j.siteId).operatorKey||!['confirmed','started'].includes(o.status)||Date.parse(v.startAt)>=Date.parse(o.endAt)||Date.parse(v.endAt)<=Date.parse(o.startAt))continue;const workers=v.workerRefs.filter(x=>o.workerRefs.includes(x));if(o.jobId===v.jobId||workers.length)conflicts.push({visitId:o.id,workerRefs:workers,reason:o.jobId===v.jobId?'Same job has an overlapping confirmed visit.':'Crew has an overlapping confirmed visit.'});}
 if(conflicts.length)issue(a,'VISIT_CONFLICT','Resolve the listed job or crew conflict.');return reviewed(w,{id:k,issues:a,conflicts,canConfirm:a.length===0});}
function jobMoney(w,j){const all=w.payments.filter(x=>x.jobId===j.id),replaced=new Set(all.map(x=>x.correctsPaymentId).filter(Boolean)),active=all.filter(x=>!replaced.has(x.id)),received=active.filter(x=>x.kind==='receipt').reduce((n,x)=>n+x.amountCents,0),refunded=active.filter(x=>x.kind==='refund').reduce((n,x)=>n+x.amountCents,0);need(Number.isSafeInteger(received)&&Number.isSafeInteger(refunded),'PAYMENT_TOTAL_OVERFLOW');const quoted=j.quoteSnapshot?j.quoteSnapshot.totals.totalCents:null;return {quotedCents:quoted,receivedCents:received,refundedCents:refunded,netReceivedCents:received-refunded,balanceCents:quoted===null?null:quoted-received+refunded};}
function jobView(w,k){const j=ref(w,'jobs',k),visits=w.visits.filter(x=>x.jobId===k),visitIds=new Set(visits.map(x=>x.id)),fieldRecords=w.fieldRecords.filter(x=>visitIds.has(x.visitId)),findings=w.findings.filter(x=>x.jobId===k),checklist=j.checklist.map(c=>{let value=null;for(const f of fieldRecords){const r=f.checkResults.find(x=>x.checkId===c.id);if(r)value={...r,fieldRecordId:f.id};}return {...c,result:'unreviewed',notes:'',evidenceIds:[],fieldRecordId:null,...value};}),requirements=j.requirements.map(c=>({...c,status:'unreviewed',reference:'',notes:'',attachmentIds:[],recordedAt:'',author:'',...(j.requirementHistory??[]).filter(x=>x.requirementId===c.id).at(-1)})),a=[];
 if(j.status==='cancelled')issue(a,'JOB_CANCELLED','This job is cancelled.');
 if(!visits.some(v=>v.status==='finished'))issue(a,'FINISHED_VISIT_REQUIRED','Complete at least one actual site visit.');
 if(visits.some(v=>['requested','confirmed','started'].includes(v.status)))issue(a,'OUTSTANDING_VISITS','Finish, abort or cancel all outstanding visits.');
 for(const c of checklist){if(c.result==='fail')issue(a,'FAILED_CHECK','A later explicit result must resolve '+c.label+'.');else if(c.required&&!['pass','not-applicable'].includes(c.result))issue(a,'REQUIRED_CHECK','Record '+c.label+'.');if(c.result==='not-applicable'&&!c.notes.trim())issue(a,'CHECK_REASON','State why '+c.label+' is not applicable.');if(c.evidenceRequired&&c.result==='pass'&&!c.evidenceIds.length)issue(a,'CHECK_EVIDENCE','Attach the actual evidence for '+c.label+'.');}
 for(const r of requirements){if(r.required&&!['recorded','not-applicable'].includes(r.status))issue(a,'REQUIRED_DOCUMENT','Record '+r.label+'.');if(r.status==='not-applicable'&&!r.notes.trim())issue(a,'DOCUMENT_REASON','State why '+r.label+' is not applicable.');if(r.required&&r.status==='recorded'&&['document','certificate'].includes(r.kind)&&(!r.reference.trim()||!r.attachmentIds.length))issue(a,'DOCUMENT_EVIDENCE','Attach the original and reference for '+r.label+'.');}
 if(findings.some(x=>x.status==='open'&&x.severity==='blocking'))issue(a,'OPEN_BLOCKING_FINDING','Resolve each blocking finding before current handover.');
 const frozen=j.startedSnapshot??null;return {job:j,site:frozen?.site??ref(w,'sites',j.siteId),appliance:frozen?.appliance??(j.applianceId?ref(w,'appliances',j.applianceId):null),quote:j.quoteSnapshot??null,visits,fieldRecords,findings,checklist,requirements,payments:w.payments.filter(x=>x.jobId===k),handovers:w.handovers.filter(x=>x.jobId===k),servicePlans:w.servicePlans.filter(x=>x.jobId===k),money:jobMoney(w,j),readiness:{ready:a.length===0,issues:a},canEdit:j.status==='planned'&&!visits.some(x=>x.startedAt)};}
function reviewHandover(w,input){fields(input,['jobId','completedAt','author','summary','documentIds','customerAcknowledgement','notes']);const v=jobView(w,input.jobId),a=v.readiness.issues.slice(),completedAt=instant(input.completedAt,true),author=str(input.author),summary=str(input.summary),notes=str(input.notes);if(!completedAt||!author.trim()||!summary.trim())issue(a,'HANDOVER_DETAILS','Record the actual completion time, author and summary.');if(v.handovers.length&&!notes.trim())issue(a,'HANDOVER_CORRECTION_REASON','Explain this later handover edition.');
 const documentIds=evidence(w,input.documentIds,v.job.siteId,v.job.id);let ack=null;if(input.customerAcknowledgement){fields(input.customerAcknowledgement,['at','by','reference']);ack={at:instant(input.customerAcknowledgement.at),by:text(input.customerAcknowledgement.by,true),reference:str(input.customerAcknowledgement.reference)};}
 if(completedAt&&v.visits.some(x=>x.finishedAt&&Date.parse(x.finishedAt)>Date.parse(completedAt)))issue(a,'HANDOVER_TIME_ORDER','Completion must follow its retained visits.');
 const snapshot={job:clone(v.job),site:clone(v.site),appliance:clone(v.appliance),quote:clone(v.quote),visits:clone(v.visits),fieldRecords:clone(v.fieldRecords),findings:clone(v.findings),checklist:clone(v.checklist),requirements:clone(v.requirements),requirementHistory:clone(v.job.requirementHistory??[]),payments:clone(v.payments),money:clone(v.money),completedAt,author,summary,documentIds,documents:documentIds.map(k=>{const {base64,...m}=ref(w,'attachments',k);return m;}),customerAcknowledgement:ack,notes};
 return reviewed(w,{jobId:input.jobId,issues:a,canCommit:a.length===0,snapshot});}
function visitView(w,k){const v=ref(w,'visits',k),j=ref(w,'jobs',v.jobId),s=v.snapshot??null;return {visit:v,job:s?.job??j,site:s?.site??ref(w,'sites',j.siteId),appliance:s?.appliance??(j.applianceId?ref(w,'appliances',j.applianceId):null),fieldRecords:w.fieldRecords.filter(x=>x.visitId===k),findings:w.findings.filter(x=>x.visitId===k),canStart:v.status==='confirmed'&&!['completed','cancelled'].includes(j.status),canFinish:v.status==='started'&&w.fieldRecords.some(x=>x.visitId===k),canAbort:v.status==='started',canEdit:['requested','confirmed'].includes(v.status)&&!['completed','cancelled'].includes(j.status)};}
function siteView(w,k){const site=ref(w,'sites',k),jobs=w.jobs.filter(x=>x.siteId===k),jobIds=new Set(jobs.map(x=>x.id));return {site,appliances:w.appliances.filter(x=>x.siteId===k),enquiries:w.enquiries.filter(x=>x.siteId===k),surveys:w.surveys.filter(x=>x.siteId===k),quotes:w.quotes.filter(x=>x.siteId===k),jobs,visits:w.visits.filter(x=>jobIds.has(x.jobId)),handovers:w.handovers.filter(x=>jobIds.has(x.jobId)),servicePlans:w.servicePlans.filter(x=>jobIds.has(x.jobId))};}
function dayPlan(w,d){date(d);const bounds=new Map(),next=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 function selectedBounds(tz){const key=tz||'UTC';if(bounds.has(key))return bounds.get(key);const origin=Date.parse(d+'T00:00:00Z'),formatter=new Intl.DateTimeFormat('en',{timeZone:key,year:'numeric',month:'2-digit',day:'2-digit'}),day=epoch=>{const p=formatter.formatToParts(new Date(epoch));return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
  function first(target){let low=origin-172800000,high=origin+259200000;while(low<high){const mid=Math.floor((low+high)/2);if(day(mid)<target)low=mid+1;else high=mid;}return low;}
  const value={start:first(d),end:first(next)};bounds.set(key,value);return value;
 }
 const visits=w.visits.filter(v=>{if(!v.startAt||!v.endAt)return false;const b=selectedBounds(v.timezone);return Date.parse(v.startAt)<b.end&&Date.parse(v.endAt)>b.start;}).map(v=>({visit:v,job:ref(w,'jobs',v.jobId),site:ref(w,'sites',ref(w,'jobs',v.jobId).siteId),appliance:ref(w,'jobs',v.jobId).applianceId?ref(w,'appliances',ref(w,'jobs',v.jobId).applianceId):null})),m=new Map();
 for(const {visit:v}of visits)if(['confirmed','started','finished'].includes(v.status)){const b=selectedBounds(v.timezone),minutes=Math.round((Math.min(Date.parse(v.endAt),b.end)-Math.max(Date.parse(v.startAt),b.start))/60000);const operatorKey=ref(w,'sites',ref(w,'jobs',v.jobId).siteId).operatorKey;for(const worker of v.workerRefs){const workerKey=operatorKey+'\n'+worker,x=m.get(workerKey)??{operatorKey,workerRef:worker,confirmedMinutes:0,visits:[]};x.confirmedMinutes+=minutes;x.visits.push(v.id);m.set(workerKey,x);}}
 return {date:d,visits,workers:[...m.values()]};
}
function localDay(at,tz){const p=new Intl.DateTimeFormat('en',{timeZone:tz||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');}
function summary(w){const today=new Date().toISOString().slice(0,10);return {sites:w.sites.length,appliances:w.appliances.length,enquiries:w.enquiries.length,openEnquiries:w.enquiries.filter(x=>x.status==='open').length,surveys:w.surveys.length,finalSurveys:w.surveys.filter(x=>x.status==='finalized').length,quotes:w.quotes.length,acceptedQuotes:w.quotes.filter(x=>x.status==='accepted').length,jobs:w.jobs.length,openJobs:w.jobs.filter(x=>!['completed','cancelled'].includes(x.status)).length,visits:w.visits.length,confirmedVisits:w.visits.filter(x=>x.status==='confirmed').length,findings:w.findings.length,openBlockingFindings:w.findings.filter(x=>x.status==='open'&&x.severity==='blocking').length,handovers:w.handovers.length,servicePlans:w.servicePlans.length,dueServicePlans:w.servicePlans.filter(x=>x.status==='open'&&x.dueOn<=today).length,attachments:w.attachments.length,imports:w.imports.length};}

function mutate(w,command){
 validate(w);need(plain(command)&&typeof command.type==='string','COMMAND_REQUIRED');
 const retryKey=['handover.commit','import.commit'].includes(command.type)?hash({type:command.type,input:command.input,decisions:command.decisions??null,expectedReviewSha:command.expectedReviewSha}):null;
 if(retryKey&&(command.type==='handover.commit'?w.handovers:w.imports).some(x=>x.requestKey===retryKey))return w;
 need(command.expectedRevision===w.revision,'WORKSPACE_CHANGED_REVIEW_AGAIN');
 const n=clone(w),revision=w.revision+1,at=instant(command.at??new Date().toISOString()),actor=str(command.actor??'Operator'),changes=[];
 function put(collection,value){
  id(value.id);const previous=n[collection].find(x=>x.id===value.id),record={...value,createdRevision:previous?.createdRevision??revision,updatedRevision:revision};
  n[collection]=n[collection].filter(x=>x.id!==record.id).concat([record]);changes.push({collection,id:record.id,beforeSha256:previous?hash(previous):null,after:clone(record)});return record;
 }
 function update(collection,k,patch){return put(collection,{...ref(n,collection,k),...patch});}
 function fresh(collection,k){need(!n[collection].some(x=>x.id===k),'ORIGINAL_RECORD_EXISTS');id(k);}
 function kind(v,values){need(values.includes(v),'INVALID_CHOICE');return v;}
 function reason(){return text(command.reason,true);}
 function editableJob(k){const j=ref(n,'jobs',k);need(!['completed','cancelled'].includes(j.status),'JOB_CLOSED');return j;}
 function editableVisit(k,statuses){const v=ref(n,'visits',k);need(statuses.includes(v.status),'VISIT_STATE_CHANGED');editableJob(v.jobId);return v;}
 function checks(a,forSurvey,siteId,jobId){return unique(a??[],x=>x.id??x.checkId).map(c=>{
  fields(c,forSurvey?['id','label','result','notes','evidenceIds']:['checkId','result','notes','evidenceIds']);
  return {...(forSurvey?{id:id(c.id),label:text(c.label,true)}:{checkId:id(c.checkId)}),result:kind(c.result,forSurvey?['unreviewed','pass','fail','not-applicable']:['pass','fail','not-applicable']),notes:str(c.notes),evidenceIds:evidence(n,c.evidenceIds,siteId,jobId)};
 });}
 function record(){need(plain(command.record),'RECORD_REQUIRED');return command.record;}
 switch(command.type){
 case 'site.save':{
  const r=record();fields(r,['id','operatorKey','customerRef','propertyRef','address','contact','access','notes']);id(r.id);need(n.catalogue.operators.some(o=>o.key===r.operatorKey),'OPERATOR_NOT_IN_CATALOGUE');
  const old=n.sites.find(x=>x.id===r.id);need(!old||old.operatorKey===r.operatorKey,'SITE_OPERATOR_IMMUTABLE');need(!n.sites.some(x=>x.id!==r.id&&x.operatorKey===r.operatorKey&&x.propertyRef===r.propertyRef),'PROPERTY_REFERENCE_EXISTS');
  put('sites',{id:r.id,operatorKey:r.operatorKey,customerRef:text(r.customerRef,true),propertyRef:text(r.propertyRef,true),address:str(r.address),contact:str(r.contact),access:str(r.access),notes:str(r.notes)});break;
 }
 case 'appliance.save':{
  const r=record();fields(r,['id','siteId','label','makeModel','serialNumber','fuelType','location','installedOn','notes']);ref(n,'sites',r.siteId);const old=n.appliances.find(x=>x.id===r.id);need(!old||old.siteId===r.siteId,'APPLIANCE_SITE_IMMUTABLE');
  put('appliances',{id:id(r.id),siteId:r.siteId,label:text(r.label,true),makeModel:str(r.makeModel),serialNumber:str(r.serialNumber),fuelType:str(r.fuelType),location:str(r.location),installedOn:date(r.installedOn,true),notes:str(r.notes)});break;
 }
 case 'enquiry.save':{
  const r=record();fields(r,['id','siteId','applianceId','kind','title','reference','requestedDate','details','attachmentIds']);links(n,r);const old=n.enquiries.find(x=>x.id===r.id);need(!old||old.status==='open','ENQUIRY_CLOSED');need(!old||old.siteId===r.siteId,'ENQUIRY_SITE_IMMUTABLE');
  put('enquiries',{id:id(r.id),siteId:r.siteId,applianceId:r.applianceId||null,kind:kind(r.kind,['installation','service','sweep','repair','other']),title:text(r.title,true),reference:str(r.reference),requestedDate:date(r.requestedDate,true),details:str(r.details),attachmentIds:evidence(n,r.attachmentIds,r.siteId),status:'open',events:old?.events??[]});break;
 }
 case 'enquiry.close':case 'enquiry.reopen':{
  const e=ref(n,'enquiries',command.id),closed=command.type==='enquiry.close';need(e.status===(closed?'open':'closed'),'ENQUIRY_STATE_CHANGED');const why=reason();update('enquiries',e.id,{status:closed?'closed':'open',events:[...e.events,{at,actor,action:closed?'closed':'reopened',reason:why}]});break;
 }
 case 'attachment.add':{
  const r=record();fields(r,['id','name','mime','base64','description','siteId','jobId']);fresh('attachments',r.id);text(r.name,true,255);need(!/[/\\\u0000-\u001f]/.test(r.name)&&r.name!=='.'&&r.name!=='..','INVALID_FILENAME');const raw=unbase64(r.base64);need(raw.length<=MAX_FILE,'ATTACHMENT_TOO_LARGE');
  if(r.siteId)ref(n,'sites',r.siteId);if(r.jobId){const j=ref(n,'jobs',r.jobId);need(!r.siteId||j.siteId===r.siteId,'ATTACHMENT_SITE_CHANGED');}
  put('attachments',{id:r.id,name:r.name,mime:text(r.mime||'application/octet-stream',true,160),base64:r.base64,description:str(r.description),siteId:r.siteId||null,jobId:r.jobId||null,bytes:raw.length,sha256:sha(raw)});break;
 }
 case 'survey.save':{
  const r=record();fields(r,['id','siteId','enquiryId','applianceId','replacesSurveyId','conductedAt','author','observations','applianceProposal','measurements','checks','attachmentIds']);links(n,r);const old=n.surveys.find(x=>x.id===r.id);need(!old||old.status==='draft','SURVEY_EDITION_FROZEN');need(!old||old.siteId===r.siteId,'SURVEY_SITE_IMMUTABLE');
  if(r.replacesSurveyId){const p=ref(n,'surveys',r.replacesSurveyId);need(p.status==='finalized'&&p.siteId===r.siteId&&p.id!==r.id,'SURVEY_PREDECESSOR_CHANGED');}
  put('surveys',{id:id(r.id),siteId:r.siteId,enquiryId:r.enquiryId||null,applianceId:r.applianceId||null,replacesSurveyId:r.replacesSurveyId||null,conductedAt:instant(r.conductedAt,true),author:str(r.author),observations:str(r.observations),applianceProposal:str(r.applianceProposal),measurements:measurements(r.measurements),checks:checks(r.checks,true,r.siteId),attachmentIds:evidence(n,r.attachmentIds,r.siteId),status:'draft'});break;
 }
 case 'survey.finalize':{
  const review=reviewSurvey(n,command.id);need(review.reviewSha256===command.expectedReviewSha,'SURVEY_REVIEW_CHANGED');need(review.canFinalize,'SURVEY_NOT_READY');const r=ref(n,'surveys',command.id),snapshot={...identity(n,r),survey:clone(r)};
  update('surveys',r.id,{status:'finalized',finalizedAt:at,finalizedBy:actor,snapshot,snapshotSha256:hash(snapshot)});break;
 }
 case 'quote.save':{
  const r=record();fields(r,['id','siteId','enquiryId','surveyId','applianceId','replacesQuoteId','title','issuedOn','validUntil','currency','scope','exclusions','terms','lines','discountCents','taxBasisPoints','depositCents','attachmentIds']);links(n,r);const old=n.quotes.find(x=>x.id===r.id);need(!old||old.status==='draft','QUOTE_EDITION_FROZEN');need(!old||old.siteId===r.siteId,'QUOTE_SITE_IMMUTABLE');
  if(r.surveyId){const s=ref(n,'surveys',r.surveyId);need(s.status==='finalized'&&s.siteId===r.siteId&&(!s.applianceId||s.applianceId===(r.applianceId||null)),'QUOTE_SURVEY_CHANGED');}
  if(r.replacesQuoteId){const p=ref(n,'quotes',r.replacesQuoteId);need(p.id!==r.id&&p.siteId===r.siteId&&p.status!=='draft','QUOTE_PREDECESSOR_CHANGED');}
  const lines=unique(r.lines??[],x=>x.id).map(l=>{fields(l,['id','label','quantityMilli','unitPriceCents']);return {id:id(l.id),label:text(l.label,true),quantityMilli:amount(l.quantityMilli),unitPriceCents:amount(l.unitPriceCents)};});
  const q={id:id(r.id),siteId:r.siteId,enquiryId:r.enquiryId||null,surveyId:r.surveyId||null,applianceId:r.applianceId||null,replacesQuoteId:r.replacesQuoteId||null,title:text(r.title,true),issuedOn:date(r.issuedOn,true),validUntil:date(r.validUntil,true),currency:str(r.currency).toUpperCase(),scope:str(r.scope),exclusions:str(r.exclusions),terms:str(r.terms),lines,discountCents:amount(r.discountCents),taxBasisPoints:amount(r.taxBasisPoints),depositCents:amount(r.depositCents),attachmentIds:evidence(n,r.attachmentIds,r.siteId),status:'draft',decisions:[]};quoteTotals(q);put('quotes',q);break;
 }
 case 'quote.issue':{
  const review=reviewQuote(n,command.id);need(review.reviewSha256===command.expectedReviewSha,'QUOTE_REVIEW_CHANGED');need(review.canIssue,'QUOTE_NOT_READY');const q=ref(n,'quotes',command.id),snapshot={...identity(n,q),survey:q.surveyId?clone(ref(n,'surveys',q.surveyId)):null,quote:clone(q),totals:review.totals};update('quotes',q.id,{status:'issued',issuedAt:at,snapshot,snapshotSha256:hash(snapshot)});break;
 }
 case 'quote.decide':{
  const q=ref(n,'quotes',command.id);need(q.status==='issued','QUOTE_DECISION_ALREADY_RECORDED');const decision=kind(command.decision,['accepted','declined','withdrawn']),decidedAt=instant(command.decidedAt),by=text(command.by,true);
  const decisionDate=command.decidedAt.slice(0,10);need(decisionDate>=q.issuedOn,'QUOTE_DECISION_BEFORE_ISSUE');if(decision==='accepted')need(decisionDate<=q.validUntil,'QUOTE_EXPIRED_CREATE_NEW_EDITION');
  update('quotes',q.id,{status:decision,decisions:[...q.decisions,{decision,decidedAt,sourceDecidedAt:command.decidedAt,by,reference:str(command.reference),notes:str(command.notes)}]});break;
 }
 case 'job.save':{
  const r=record();fields(r,['id','siteId','applianceId','enquiryId','quoteId','parentJobId','kind','title','scope','notes','checklist','requirements']);links(n,r);const old=n.jobs.find(x=>x.id===r.id);need(!old||jobView(n,r.id).canEdit,'JOB_SCOPE_FROZEN');need(!old||old.siteId===r.siteId,'JOB_SITE_IMMUTABLE');if(old?.quoteId)need(old.quoteId===(r.quoteId||null),'JOB_QUOTE_IMMUTABLE');
  let quoteSnapshot=null,scope=str(r.scope);if(r.quoteId){const q=ref(n,'quotes',r.quoteId);need(q.status==='accepted'&&q.siteId===r.siteId&&(q.applianceId||null)===(r.applianceId||null),'ACCEPTED_QUOTE_REQUIRED');need(!n.jobs.some(j=>j.id!==r.id&&j.quoteId===q.id),'QUOTE_ALREADY_ASSIGNED');scope=q.scope;quoteSnapshot={...clone(q),totals:quoteTotals(q).totals};}
  text(scope,true);if(r.parentJobId){const p=ref(n,'jobs',r.parentJobId);need(p.id!==r.id&&p.siteId===r.siteId,'PARENT_JOB_CHANGED');let walk=p;const seen=new Set([r.id]);while(walk){need(!seen.has(walk.id),'PARENT_JOB_CYCLE');seen.add(walk.id);walk=walk.parentJobId?ref(n,'jobs',walk.parentJobId):null;}}
  const checklist=unique(r.checklist??[],x=>x.id).map(x=>{fields(x,['id','label','required','evidenceRequired']);need(typeof x.required==='boolean'&&typeof x.evidenceRequired==='boolean','CHECK_REQUIREMENTS_REQUIRED');return {id:id(x.id),label:text(x.label,true),required:x.required,evidenceRequired:x.evidenceRequired};}),requirements=unique(r.requirements??[],x=>x.id).map(x=>{fields(x,['id','label','kind','required']);need(typeof x.required==='boolean','REQUIREMENT_REQUIRED');return {id:id(x.id),label:text(x.label,true),kind:kind(x.kind,['document','acknowledgement','certificate','other']),required:x.required};});
  const reqHistory=old?.requirementHistory??[];need(reqHistory.every(h=>requirements.some(x=>x.id===h.requirementId&&canonical(x)===canonical(old.requirements.find(o=>o.id===h.requirementId)))),'RECORDED_REQUIREMENT_CANNOT_CHANGE');
  put('jobs',{id:id(r.id),siteId:r.siteId,applianceId:r.applianceId||null,enquiryId:r.enquiryId||null,quoteId:r.quoteId||null,parentJobId:r.parentJobId||null,kind:kind(r.kind,['installation','service','sweep','repair','other']),title:text(r.title,true),scope,notes:str(r.notes),checklist,requirements,requirementHistory:reqHistory,quoteSnapshot,status:'planned',events:old?.events??[]});break;
 }
 case 'job.cancel':{
  const j=editableJob(command.id),why=reason();need(!n.visits.some(v=>v.jobId===j.id&&v.status==='started'),'ABORT_ACTIVE_VISIT_FIRST');for(const v of n.visits.filter(v=>v.jobId===j.id&&['requested','confirmed'].includes(v.status)))update('visits',v.id,{status:'cancelled',events:[...v.events,{at,actor,action:'cancelled',reason:why}]});
  update('jobs',j.id,{status:'cancelled',events:[...j.events,{at,actor,action:'cancelled',reason:why}]});break;
 }
 case 'visit.save':{
  const r=record();fields(r,['id','jobId','kind','startAt','endAt','timezone','workerRefs','notes']);const j=editableJob(r.jobId),old=n.visits.find(x=>x.id===r.id);need(!old||['requested','confirmed'].includes(old.status),'VISIT_RECORD_FROZEN');need(!old||old.jobId===r.jobId,'VISIT_JOB_IMMUTABLE');if(old?.status==='confirmed')need(Date.parse(old.startAt)>Date.parse(at),'PAST_CONFIRMED_VISIT_RECORD_ACTUAL_OUTCOME');const workers=unique(r.workerRefs??[]).map(x=>text(x,true,160));const startAt=instant(r.startAt,true),endAt=instant(r.endAt,true);if(startAt&&endAt)need(Date.parse(endAt)>Date.parse(startAt),'VISIT_INTERVAL_ORDER');
  put('visits',{id:id(r.id),jobId:j.id,kind:kind(r.kind,['survey','installation','service','sweep','repair','other']),startAt,endAt,timezone:zone(r.timezone),workerRefs:workers,notes:str(r.notes),status:'requested',events:[...(old?.events??[]),...(old?.status==='confirmed'?[{at,actor,action:'confirmation-reset',reason:'Appointment details changed; a fresh confirmation is required.',previous:{startAt:old.startAt,endAt:old.endAt,timezone:old.timezone,workerRefs:old.workerRefs}}]:[])]});break;
 }
 case 'visit.confirm':{
  const review=reviewVisit(n,command.id);need(review.reviewSha256===command.expectedReviewSha,'VISIT_REVIEW_CHANGED');need(review.canConfirm,'VISIT_NOT_READY');const v=ref(n,'visits',command.id);update('visits',v.id,{status:'confirmed',events:[...v.events,{at,actor,action:'confirmed',confirmedBy:text(command.confirmedBy,true),reference:str(command.reference),startAt:v.startAt,endAt:v.endAt,timezone:v.timezone,workerRefs:clone(v.workerRefs)}]});break;
 }
 case 'visit.start':{
  const v=editableVisit(command.id,['confirmed']),j=ref(n,'jobs',v.jobId),startedAt=instant(command.startedAt),author=text(command.author,true);need(!n.visits.some(x=>x.id!==v.id&&x.jobId===j.id&&x.status==='started'),'JOB_VISIT_ALREADY_STARTED');
  const snapshot={job:clone(j),...identity(n,j)};update('visits',v.id,{status:'started',startedAt,startedBy:author,snapshot,snapshotSha256:hash(snapshot),events:[...v.events,{at,actor,action:'started',startedAt,author}]});if(j.status==='planned')update('jobs',j.id,{status:'in-progress',startedAt,startedSnapshot:identity(n,j),events:[...j.events,{at,actor,action:'started',visitId:v.id}]});break;
 }
 case 'visit.finish':case 'visit.abort':{
  const v=editableVisit(command.id,['started']),finishedAt=instant(command.finishedAt),author=text(command.author,true),abort=command.type==='visit.abort';need(Date.parse(finishedAt)>=Date.parse(v.startedAt),'VISIT_ACTUAL_TIME_ORDER');need(n.fieldRecords.filter(f=>f.visitId===v.id).every(f=>Date.parse(f.recordedAt)<=Date.parse(finishedAt)),'FIELD_RECORD_AFTER_FINISH');if(!abort)need(n.fieldRecords.some(f=>f.visitId===v.id),'FIELD_RECORD_REQUIRED');
  const detail=abort?{reason:reason()}:{notes:str(command.notes)};update('visits',v.id,{status:abort?'aborted':'finished',finishedAt,finishedBy:author,...detail,events:[...v.events,{at,actor,action:abort?'aborted':'finished',finishedAt,author,...detail}]});break;
 }
 case 'visit.cancel':{
  const v=editableVisit(command.id,['requested','confirmed']);update('visits',v.id,{status:'cancelled',events:[...v.events,{at,actor,action:'cancelled',reason:reason()}]});break;
 }
 case 'field.add':{
  const r=record();fields(r,['id','visitId','recordedAt','author','notes','measurements','checkResults','attachmentIds']);fresh('fieldRecords',r.id);const v=editableVisit(r.visitId,['started']),j=ref(n,'jobs',v.jobId),recordedAt=instant(r.recordedAt);need(Date.parse(recordedAt)>=Date.parse(v.startedAt),'FIELD_TIME_BEFORE_VISIT');
  const checkResults=checks(r.checkResults,false,j.siteId,j.id);need(checkResults.every(c=>v.snapshot.job.checklist.some(x=>x.id===c.checkId)),'CHECK_NOT_IN_FROZEN_VISIT');
  for(const c of checkResults)if(['fail','not-applicable'].includes(c.result))text(c.notes,true);
  put('fieldRecords',{id:r.id,visitId:v.id,jobId:j.id,recordedAt,author:text(r.author,true),notes:str(r.notes),measurements:measurements(r.measurements),checkResults,attachmentIds:evidence(n,r.attachmentIds,j.siteId,j.id)});break;
 }
 case 'finding.save':{
  const r=record();fields(r,['id','jobId','visitId','severity','description','evidenceIds']);const j=ref(n,'jobs',r.jobId);need(j.status!=='cancelled','JOB_CANCELLED');const old=n.findings.find(x=>x.id===r.id);need(!old||old.status==='open','FINDING_CLOSED');need(!old||(old.jobId===r.jobId&&(old.visitId||null)===(r.visitId||null)),'FINDING_IDENTITY_IMMUTABLE');if(r.visitId)need(ref(n,'visits',r.visitId).jobId===j.id,'FINDING_VISIT_CHANGED');
  put('findings',{id:id(r.id),jobId:j.id,visitId:r.visitId||null,severity:kind(r.severity,['note','follow-up','blocking']),description:text(r.description,true),evidenceIds:evidence(n,r.evidenceIds,j.siteId,j.id),status:'open',events:old?.events??[]});break;
 }
 case 'finding.resolve':case 'finding.reopen':{
  const f=ref(n,'findings',command.id),j=ref(n,'jobs',f.jobId),resolve=command.type==='finding.resolve';need(f.status===(resolve?'open':'resolved'),'FINDING_STATE_CHANGED');const detail=resolve?{resolution:text(command.resolution,true),evidenceIds:evidence(n,command.evidenceIds,j.siteId,j.id)}:{reason:reason()};
  update('findings',f.id,{status:resolve?'resolved':'open',events:[...f.events,{at,actor,action:resolve?'resolved':'reopened',...detail}]});break;
 }
 case 'job.requirement':{
  const j=ref(n,'jobs',command.jobId);need(j.status!=='cancelled','JOB_CANCELLED');const r=j.requirements.find(x=>x.id===command.requirementId);need(r,'REQUIREMENT_NOT_FOUND');const status=kind(command.status,['recorded','not-applicable']),notes=str(command.notes),reference=str(command.reference),attachmentIds=evidence(n,command.attachmentIds,j.siteId,j.id);if(status==='not-applicable'||j.requirementHistory.some(h=>h.requirementId===r.id))text(notes,true);
  if(status==='recorded'&&r.required&&['document','certificate'].includes(r.kind))need(reference.trim()&&attachmentIds.length,'ACTUAL_DOCUMENT_AND_REFERENCE_REQUIRED');
  update('jobs',j.id,{requirementHistory:[...j.requirementHistory,{id:'requirement_'+j.id+'_'+revision,requirementId:r.id,status,reference,notes,attachmentIds,recordedAt:instant(command.recordedAt),author:text(command.author,true),revision}]});break;
 }
 case 'payment.add':{
  const r=record();fields(r,['id','jobId','kind','amountCents','currency','paidAt','reference','notes','correctsPaymentId']);fresh('payments',r.id);const j=ref(n,'jobs',r.jobId),currency=text(r.currency,true,3).toUpperCase();need(/^[A-Z]{3}$/.test(currency),'CURRENCY_REQUIRED');need(!j.quoteSnapshot||j.quoteSnapshot.currency===currency,'QUOTE_PAYMENT_CURRENCY_CHANGED');need(n.payments.filter(x=>x.jobId===j.id).every(x=>x.currency===currency),'JOB_PAYMENT_CURRENCY_CHANGED');const paymentKind=kind(r.kind,['receipt','refund']);
  if(r.correctsPaymentId){const prior=ref(n,'payments',r.correctsPaymentId);need(prior.jobId===j.id&&prior.kind===paymentKind&&prior.currency===currency&&!n.payments.some(x=>x.correctsPaymentId===prior.id),'PAYMENT_CORRECTION_CHANGED');text(r.notes,true);}
  put('payments',{id:r.id,jobId:j.id,kind:paymentKind,amountCents:integer(r.amountCents,1),currency,paidAt:instant(r.paidAt),reference:text(r.reference,true),notes:str(r.notes),correctsPaymentId:r.correctsPaymentId||null});const m=jobMoney(n,j);need(m.refundedCents<=m.receivedCents,'REFUND_EXCEEDS_RECEIPTS');break;
 }
 case 'handover.commit':{
  const review=reviewHandover(n,command.input);need(review.reviewSha256===command.expectedReviewSha,'HANDOVER_REVIEW_CHANGED');need(review.canCommit,'HANDOVER_NOT_READY');const j=ref(n,'jobs',review.jobId);
  put('handovers',{id:'handover_'+review.reviewSha256,jobId:j.id,edition:n.handovers.filter(h=>h.jobId===j.id).length+1,reviewSha256:review.reviewSha256,requestKey:retryKey,snapshot:review.snapshot,snapshotSha256:hash(review.snapshot),committedAt:at,committedBy:actor});update('jobs',j.id,{status:'completed',completedAt:review.snapshot.completedAt,events:[...j.events,{at,actor,action:'handover-committed',handoverId:'handover_'+review.reviewSha256}]});break;
 }
 case 'servicePlan.save':{
  const r=record();fields(r,['id','jobId','applianceId','dueOn','reason','notes']);const j=ref(n,'jobs',r.jobId),a=ref(n,'appliances',r.applianceId),old=n.servicePlans.find(x=>x.id===r.id);need(j.siteId===a.siteId&&j.applianceId===a.id,'SERVICE_APPLIANCE_CHANGED');need(!old||old.status==='open'&&old.jobId===j.id&&old.applianceId===a.id,'SERVICE_PLAN_IDENTITY_CHANGED');
  put('servicePlans',{id:id(r.id),jobId:j.id,applianceId:a.id,dueOn:date(r.dueOn),reason:text(r.reason,true),notes:str(r.notes),status:'open',targetJobId:old?.targetJobId??null,events:old?.events??[],notificationStatus:'not-sent'});break;
 }
 case 'servicePlan.link':{
  const p=ref(n,'servicePlans',command.id),j=ref(n,'jobs',p.jobId),target=ref(n,'jobs',command.targetJobId);need(p.status==='open'&&target.id!==j.id&&target.siteId===j.siteId&&target.applianceId===p.applianceId,'SERVICE_TARGET_CHANGED');update('servicePlans',p.id,{targetJobId:target.id,events:[...p.events,{at,actor,action:'linked',targetJobId:target.id}]});break;
 }
 case 'servicePlan.close':case 'servicePlan.reopen':{
  const p=ref(n,'servicePlans',command.id),close=command.type==='servicePlan.close';need(p.status===(close?'open':'closed'),'SERVICE_PLAN_STATE_CHANGED');update('servicePlans',p.id,{status:close?'closed':'open',events:[...p.events,{at,actor,action:close?'closed':'reopened',reason:reason()}]});break;
 }
 case 'import.commit':{
  const review=reviewImport(n,command.input);need(review.reviewSha256===command.expectedReviewSha,'IMPORT_REVIEW_CHANGED');need(!review.issues.length,'IMPORT_SOURCE_INVALID');need(!n.imports.some(x=>x.attachmentId===review.attachmentId&&x.operatorKey===review.operatorKey&&x.entity===review.entity),'SOURCE_ALREADY_IMPORTED');
  const decisions=unique(command.decisions??[],x=>x.rowId);need(decisions.length===review.rows.length&&review.rows.every(x=>decisions.some(d=>d.rowId===x.rowId)),'EVERY_ROW_DECISION_REQUIRED');const results=[];
  for(const row of review.rows){const d=decisions.find(x=>x.rowId===row.rowId);fields(d,['rowId','action','id','targetId','reason']);kind(d.action,['create','link','ignore']);const c={site:'sites',appliance:'appliances',enquiry:'enquiries'}[review.entity];let targetId=null;
   if(d.action==='ignore')text(d.reason,true);
   else if(d.action==='link'){const target=ref(n,c,d.targetId),s=review.entity==='site'?target:ref(n,'sites',target.siteId);need(s.operatorKey===review.operatorKey,'IMPORT_LINK_OPERATOR_CHANGED');targetId=target.id;}
   else{
    need(!row.issues.length,'IMPORT_ROW_INVALID');fresh(c,d.id);targetId=d.id;
    // Normalize all rows inside one atomic intake; do not recursively copy the entire workspace per row.
    const p=row.proposed;let value;
    if(review.entity==='site'){
     need(!n.sites.some(s=>s.operatorKey===review.operatorKey&&s.propertyRef===p.propertyRef),'PROPERTY_REFERENCE_EXISTS');
     value={id:d.id,operatorKey:review.operatorKey,customerRef:text(p.customerRef,true),propertyRef:text(p.propertyRef,true),address:str(p.address),contact:str(p.contact),access:str(p.access),notes:str(p.notes)};
    }else if(review.entity==='appliance'){
     need(ref(n,'sites',p.siteId).operatorKey===review.operatorKey,'IMPORT_SITE_OPERATOR_CHANGED');
     value={id:d.id,siteId:p.siteId,label:text(p.label,true),makeModel:str(p.makeModel),serialNumber:str(p.serialNumber),fuelType:str(p.fuelType),location:str(p.location),installedOn:date(p.installedOn,true),notes:str(p.notes)};
    }else{
     need(links(n,p).operatorKey===review.operatorKey,'IMPORT_SITE_OPERATOR_CHANGED');
     value={id:d.id,siteId:p.siteId,applianceId:p.applianceId||null,kind:kind(p.kind,['installation','service','sweep','repair','other']),title:text(p.title,true),reference:str(p.reference),requestedDate:date(p.requestedDate,true),details:str(p.details),attachmentIds:[],status:'open',events:[]};
    }put(c,value);
   }
   results.push({rowId:row.rowId,line:row.line,source:row.source,proposed:row.proposed,decision:clone(d),targetId});
  }
  put('imports',{id:'import_'+retryKey,requestKey:retryKey,attachmentId:review.attachmentId,operatorKey:review.operatorKey,entity:review.entity,input:clone(command.input),reviewSha256:review.reviewSha256,headers:review.headers,rows:results,importedAt:at,actor});break;
 }
 default:need(false,'UNKNOWN_COMMAND');
 }
 n.revision=revision;n.updatedAt=at;const entry={revision,at,actor,type:command.type,changes,previousSha256:n.history.at(-1)?.sha256??null};entry.sha256=hash(entry);n.history.push(entry);
 structural(n);need(bytes(canonical(n)).length<=MAX_WORKSPACE,'WORKSPACE_TOO_LARGE');return seal(n);
}


function csvParse(raw){const text=decode(raw),s=text.charCodeAt(0)===0xfeff?text.slice(1):text,rows=[];let row=[],cell='',quoted=false,closed=false,line=1,start=1;
 for(let i=0;i<s.length;i++){const ch=s[i];if(quoted){if(ch==='"'){if(s[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=ch;if(ch==='\n')line++;}continue;}
 if(ch==='"'){need(!cell&&!closed,'CSV_QUOTE_POSITION');quoted=true;continue;}
 if(ch===','){row.push(cell);cell='';closed=false;continue;}
 if(ch==='\n'||ch==='\r'){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell);rows.push({values:row,line:start});row=[];cell='';closed=false;line++;start=line;continue;}
 need(!closed,'CSV_AFTER_CLOSING_QUOTE');cell+=ch;
 }need(!quoted,'CSV_UNCLOSED_QUOTE');if(row.length||cell||closed){row.push(cell);rows.push({values:row,line:start});}
 need(rows.length>=1,'CSV_EMPTY');const headers=rows.shift().values.map(x=>x.trim());need(headers.length&&headers.every(Boolean),'CSV_HEADER_REQUIRED');unique(headers);for(const r of rows)need(r.values.length===headers.length,'CSV_RAGGED_ROW');return {headers,rows};
}
function reviewImport(w,input){
 fields(input,['attachmentId','operatorKey','entity','mapping','constants']);const file=ref(w,'attachments',input.attachmentId),operatorKey=input.operatorKey;need(w.catalogue.operators.some(o=>o.key===operatorKey),'OPERATOR_NOT_IN_CATALOGUE');need(['site','appliance','enquiry'].includes(input.entity),'IMPORT_ENTITY_REQUIRED');
 const allowed={site:['customerRef','propertyRef','address','contact','access','notes'],appliance:['siteRef','siteId','label','makeModel','serialNumber','fuelType','location','installedOn','notes'],enquiry:['siteRef','siteId','applianceId','kind','title','reference','requestedDate','details']}[input.entity],mapping=input.mapping??{},constants=input.constants??{};fields(mapping,allowed);fields(constants,allowed);
 const parsed=csvParse(unbase64(file.base64));for(const [k,v]of Object.entries(mapping)){need(k!=='siteId'&&typeof v==='string'&&parsed.headers.includes(v),'IMPORT_MAPPING_HEADER_REQUIRED');need(!own(constants,k),'IMPORT_FIELD_MAPPED_AND_CONSTANT');}
 const rows=parsed.rows.map((r,i)=>{const source=Object.fromEntries(parsed.headers.map((h,k)=>[h,r.values[k]])),values={};for(const k of allowed)values[k]=own(constants,k)?text(constants[k]):own(mapping,k)?source[mapping[k]]:'';const a=[];let proposed;
 if(input.entity==='site'){proposed={operatorKey,...Object.fromEntries(allowed.map(k=>[k,values[k]]))};for(const k of ['customerRef','propertyRef'])if(!values[k].trim())issue(a,'IMPORT_REQUIRED_FIELD','Map '+k+' or enter its explicit constant.');if(w.sites.some(x=>x.operatorKey===operatorKey&&x.propertyRef===values.propertyRef))issue(a,'PROPERTY_REFERENCE_EXISTS','This property already exists; link the original row explicitly.');}
 else{
  let site=null;if(values.siteId){site=w.sites.find(x=>x.id===values.siteId&&x.operatorKey===operatorKey)??null;}else{const matches=w.sites.filter(x=>x.operatorKey===operatorKey&&x.propertyRef===values.siteRef);if(matches.length===1)site=matches[0];}
  if(!site)issue(a,'IMPORT_SITE_REQUIRED','Resolve an existing site reference or configure siteId explicitly.');const fieldsOut=allowed.filter(k=>!['siteId','siteRef'].includes(k));proposed={siteId:site?.id??'',...Object.fromEntries(fieldsOut.map(k=>[k,values[k]]))};
  if(input.entity==='appliance'){if(!values.label.trim())issue(a,'IMPORT_REQUIRED_FIELD','Map an appliance label.');try{date(values.installedOn,true);}catch(e){issue(a,e.code,'Use an explicit YYYY-MM-DD installation date or leave it blank.');}}
  else{proposed.attachmentIds=[];if(!['installation','service','sweep','repair','other'].includes(values.kind))issue(a,'IMPORT_KIND_REQUIRED','Map an explicit enquiry kind.');if(!values.title.trim())issue(a,'IMPORT_REQUIRED_FIELD','Map an enquiry title.');if(values.applianceId&&!w.appliances.some(x=>x.id===values.applianceId&&x.siteId===site?.id))issue(a,'IMPORT_APPLIANCE_SITE','The selected appliance must belong to this site.');try{date(values.requestedDate,true);}catch(e){issue(a,e.code,'Use an explicit YYYY-MM-DD requested date or leave it blank.');}}
 }
 return {rowId:'row_'+(i+1),line:r.line,source,proposed,issues:a};
 });
 return reviewed(w,{attachmentId:file.id,operatorKey,entity:input.entity,headers:parsed.headers,rows,issues:[],sourceSha256:file.sha256,input:clone(input)});
}


function structural(w,full=false){
 need(w.schema===SCHEMA,'WORKSPACE_SCHEMA_CHANGED');id(w.id);text(w.title,true);integer(w.revision);instant(w.createdAt);instant(w.updatedAt);catalogueCheck(w.catalogue);need(hash(w.catalogue)===w.catalogueSha256,'CATALOGUE_IDENTITY_CHANGED');
 for(const c of collections){unique(w[c],x=>x.id);for(const r of w[c]){id(r.id);integer(r.createdRevision,1,w.revision);integer(r.updatedRevision,r.createdRevision,w.revision);}}
 for(const s of w.sites){need(w.catalogue.operators.some(o=>o.key===s.operatorKey),'SITE_OPERATOR_CHANGED');text(s.customerRef,true);text(s.propertyRef,true);}
 unique(w.sites,x=>x.operatorKey+'\n'+x.propertyRef);
 for(const a of w.appliances){ref(w,'sites',a.siteId);text(a.label,true);date(a.installedOn,true);}
 for(const e of w.enquiries){links(w,e);need(['open','closed'].includes(e.status),'ENQUIRY_STATUS_CHANGED');ids(w,e.attachmentIds);}
 for(const f of w.attachments){need(typeof f.base64==='string'&&f.bytes<=MAX_FILE,'ATTACHMENT_SIZE_CHANGED');if(f.siteId)ref(w,'sites',f.siteId);if(f.jobId){const j=ref(w,'jobs',f.jobId);need(!f.siteId||f.siteId===j.siteId,'ATTACHMENT_SITE_CHANGED');}if(full){const raw=unbase64(f.base64);need(raw.length===f.bytes&&sha(raw)===f.sha256,'ORIGINAL_ATTACHMENT_CHANGED');}}
 function snapshot(r){if(r.snapshot){need(typeof r.snapshotSha256==='string','SNAPSHOT_IDENTITY_REQUIRED');if(full)need(hash(r.snapshot)===r.snapshotSha256,'FROZEN_SNAPSHOT_CHANGED');}}
 for(const s of w.surveys){links(w,s);need(['draft','finalized'].includes(s.status),'SURVEY_STATUS_CHANGED');ids(w,s.attachmentIds);for(const c of s.checks)ids(w,c.evidenceIds);if(s.status==='finalized'){need(s.snapshot&&s.snapshot.survey.id===s.id&&s.snapshot.site.id===s.siteId,'SURVEY_SNAPSHOT_REQUIRED');snapshot(s);}}
 for(const q of w.quotes){links(w,q);need(['draft','issued','accepted','declined','withdrawn'].includes(q.status),'QUOTE_STATUS_CHANGED');quoteTotals(q);if(q.surveyId)need(ref(w,'surveys',q.surveyId).status==='finalized','QUOTE_SURVEY_CHANGED');if(q.status!=='draft'){need(q.snapshot&&q.snapshot.quote.id===q.id,'QUOTE_SNAPSHOT_REQUIRED');snapshot(q);}if(['accepted','declined','withdrawn'].includes(q.status))need(q.decisions.length===1&&q.decisions[0].decision===q.status,'QUOTE_DECISION_CHANGED');ids(w,q.attachmentIds);}
 for(const j of w.jobs){links(w,j);need(['planned','in-progress','completed','cancelled'].includes(j.status),'JOB_STATUS_CHANGED');if(j.quoteId){const q=ref(w,'quotes',j.quoteId);need(q.status==='accepted'&&j.quoteSnapshot&&j.quoteSnapshot.id===q.id&&j.scope===q.scope,'JOB_ACCEPTED_SCOPE_CHANGED');}if(j.parentJobId)need(ref(w,'jobs',j.parentJobId).siteId===j.siteId,'JOB_PARENT_CHANGED');unique(j.checklist,x=>x.id);unique(j.requirements,x=>x.id);for(const r of j.requirementHistory){need(j.requirements.some(x=>x.id===r.requirementId),'JOB_REQUIREMENT_CHANGED');ids(w,r.attachmentIds);}const money=jobMoney(w,j);need(money.refundedCents<=money.receivedCents,'REFUND_EXCEEDS_RECEIPTS');}
 unique(w.jobs.filter(j=>j.quoteId),j=>j.quoteId);
 for(const v of w.visits){const j=ref(w,'jobs',v.jobId);need(['requested','confirmed','started','finished','aborted','cancelled'].includes(v.status),'VISIT_STATUS_CHANGED');if(v.startAt)instant(v.startAt);if(v.endAt)instant(v.endAt);if(v.startedAt){need(v.snapshot?.job.id===j.id,'VISIT_SNAPSHOT_REQUIRED');snapshot(v);instant(v.startedAt);}if(v.finishedAt)need(Date.parse(instant(v.finishedAt))>=Date.parse(v.startedAt),'VISIT_TIME_ORDER');}
 for(const f of w.fieldRecords){const v=ref(w,'visits',f.visitId);need(v.startedAt&&f.jobId===v.jobId,'FIELD_VISIT_CHANGED');instant(f.recordedAt);ids(w,f.attachmentIds);for(const c of f.checkResults){need(v.snapshot.job.checklist.some(x=>x.id===c.checkId),'FIELD_CHECK_CHANGED');ids(w,c.evidenceIds);}}
 for(const f of w.findings){const j=ref(w,'jobs',f.jobId);need(['open','resolved'].includes(f.status),'FINDING_STATUS_CHANGED');if(f.visitId)need(ref(w,'visits',f.visitId).jobId===j.id,'FINDING_VISIT_CHANGED');ids(w,f.evidenceIds);}
 for(const p of w.payments){ref(w,'jobs',p.jobId);integer(p.amountCents,1);instant(p.paidAt);if(p.correctsPaymentId){const prior=ref(w,'payments',p.correctsPaymentId);need(prior.jobId===p.jobId&&prior.kind===p.kind&&prior.currency===p.currency&&prior.createdRevision<p.createdRevision,'PAYMENT_CORRECTION_CHANGED');}}
 unique(w.payments.filter(p=>p.correctsPaymentId),p=>p.correctsPaymentId);
 for(const h of w.handovers){const j=ref(w,'jobs',h.jobId);need(h.snapshot?.job.id===j.id&&h.snapshot.site.id===j.siteId&&h.id==='handover_'+h.reviewSha256,'HANDOVER_IDENTITY_CHANGED');snapshot(h);ids(w,h.snapshot.documentIds);}
 for(const p of w.servicePlans){const j=ref(w,'jobs',p.jobId);need(ref(w,'appliances',p.applianceId).siteId===j.siteId&&j.applianceId===p.applianceId,'SERVICE_APPLIANCE_CHANGED');date(p.dueOn);if(p.targetJobId){const target=ref(w,'jobs',p.targetJobId);need(target.siteId===j.siteId&&target.applianceId===p.applianceId,'SERVICE_TARGET_CHANGED');}}
 for(const i of w.imports){ref(w,'attachments',i.attachmentId);need(['site','appliance','enquiry'].includes(i.entity),'IMPORT_ENTITY_CHANGED');const c={site:'sites',appliance:'appliances',enquiry:'enquiries'}[i.entity];for(const r of i.rows)if(r.targetId)ref(w,c,r.targetId);}
 return w;
}
function validate(w,catalogue){
 need(plain(w),'WORKSPACE_REQUIRED');if(catalogue)need(hash(catalogue)===w.catalogueSha256,'SOURCE_CATALOGUE_CHANGED');if(trusted.has(w))return w;
 fields(w,['schema','id','title','revision','createdAt','updatedAt','catalogueSha256','catalogue',...collections,'history','sha256']);const body={...w};delete body.sha256;need(hash(body)===w.sha256,'WORKSPACE_BYTES_CHANGED');structural(w,true);
 need(Array.isArray(w.history)&&w.history.length===w.revision,'WORKSPACE_HISTORY_INCOMPLETE');const replay=Object.fromEntries(collections.map(c=>[c,new Map()]));let previous=null;
 for(let i=0;i<w.history.length;i++){const h=w.history[i],v={...h};delete v.sha256;need(h.revision===i+1&&h.previousSha256===previous&&hash(v)===h.sha256,'WORKSPACE_HISTORY_CHANGED');instant(h.at);text(h.actor);for(const c of h.changes){need(collections.includes(c.collection)&&c.id===c.after.id,'HISTORY_COLLECTION_CHANGED');const prior=replay[c.collection].get(c.id);need((prior?hash(prior):null)===c.beforeSha256&&c.after.updatedRevision===h.revision,'HISTORY_RECORD_CHANGED');replay[c.collection].set(c.id,c.after);}previous=h.sha256;}
 for(const c of collections){const expected=[...replay[c].values()].sort((a,b)=>a.id.localeCompare(b.id)),actual=w[c].slice().sort((a,b)=>a.id.localeCompare(b.id));need(canonical(expected)===canonical(actual),'WORKSPACE_RECORD_HISTORY_CHANGED');}
 need(bytes(canonical(w)).length<=MAX_WORKSPACE,'WORKSPACE_TOO_LARGE');trusted.add(w);return freeze(w);
}
function exportWorkspace(w){validate(w);return canonical(w)+'\n';}
function importWorkspace(s,catalogue){need(typeof s==='string'&&bytes(s).length<=MAX_WORKSPACE,'WORKSPACE_TOO_LARGE');let w;try{w=JSON.parse(s);}catch(e){need(false,'INVALID_WORKSPACE_JSON');}return validate(w,catalogue);}


const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function htmlPage(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>html,body{background:#fff;color:#202020;font:15px/1.5 system-ui,sans-serif;margin:0}main{max-width:1100px;margin:auto;padding:24px}h1,h2,h3,p,th,td,li,a{color:#202020}table{border-collapse:collapse;width:100%;margin:14px 0;table-layout:auto}td,th{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}section{margin:28px 0}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{background:#fff}small{color:#444}@media(max-width:500px){main{padding:12px}table{font-size:13px}}</style><main><h1>'+esc(title)+'</h1>'+body+'</main></html>';}
function table(head,rows){return '<div class="table"><table><thead><tr>'+head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function fileLinks(w,values){return values.map(k=>{const f=ref(w,'attachments',k);return '<li><a download="'+esc(f.name)+'" href="data:'+esc(f.mime)+';base64,'+f.base64+'">'+esc(f.name)+'</a> — '+f.bytes+' bytes; SHA-256 '+esc(f.sha256)+'</li>';}).join('');}
function operatorFor(w,c,r){if(c==='sites')return r.operatorKey;const siteId=r.siteId??(r.jobId?ref(w,'jobs',r.jobId).siteId:r.visitId?ref(w,'jobs',ref(w,'visits',r.visitId).jobId).siteId:null);return siteId?ref(w,'sites',siteId).operatorKey:r.operatorKey??'';}
function readableRows(w,operatorKey){
 const rows=[];function row(c,r,status,detail,reference,dateValue,evidenceIds=[]){const op=operatorFor(w,c,r);if(operatorKey&&op!==operatorKey)return;rows.push({collection:c,id:r.id,operator:op,site:r.siteId??(r.jobId?ref(w,'jobs',r.jobId).siteId:''),job:r.jobId??'',status:status??'',title:r.title??r.label??r.name??'',detail:detail??'',reference:reference??'',date:dateValue??'',evidence:evidenceIds.map(k=>{const f=ref(w,'attachments',k);return f.name+' ['+f.sha256+']';}).join('\n'),createdRevision:r.createdRevision,updatedRevision:r.updatedRevision});}
 for(const s of w.sites)row('sites',s,'current',[s.address,s.access,s.notes].filter(Boolean).join('\n'),s.customerRef+' / '+s.propertyRef,'');
 for(const a of w.appliances)row('appliances',a,'current',[a.makeModel,a.fuelType,a.location,a.notes].filter(Boolean).join('\n'),a.serialNumber,a.installedOn);
 for(const e of w.enquiries)row('enquiries',e,e.status,e.details,e.reference,e.requestedDate,e.attachmentIds);
 for(const s of w.surveys)row('surveys',s,s.status,[s.observations,...s.measurements.map(m=>m.label+': '+m.value+' '+m.unit+' ('+m.source+')'),...s.checks.map(c=>c.label+': '+c.result+'; '+c.notes)].join('\n'),s.replacesSurveyId,s.conductedAt,s.attachmentIds);
 for(const q of w.quotes)row('quotes',q,q.status,[q.scope,q.exclusions,q.terms,'Total '+quoteTotals(q).totals.totalCents+' minor units '+q.currency,...q.decisions.map(d=>d.decision+' at '+d.decidedAt+' by '+d.by+'; '+d.reference+'; '+d.notes)].join('\n'),q.replacesQuoteId,q.issuedOn,q.attachmentIds);
 for(const j of w.jobs){const v=jobView(w,j.id);row('jobs',j,j.status,[j.scope,j.notes,'Current readiness: '+(v.readiness.ready?'ready for reviewed handover':v.readiness.issues.map(x=>x.message).join('; ')),...v.checklist.map(c=>'Check '+c.label+': '+c.result+'; '+c.notes+'; evidence '+c.evidenceIds.join(', ')),...v.requirements.map(r=>'Requirement '+r.label+': '+r.status+'; '+r.reference+'; '+r.notes+'; originals '+r.attachmentIds.join(', ')),...j.requirementHistory.map(r=>'Requirement record '+r.requirementId+' at '+r.recordedAt+' by '+r.author+': '+r.status+'; '+r.reference+'; '+r.notes),...j.events.map(e=>e.action+' '+e.at+' '+(e.reason??''))].join('\n'),j.quoteId??j.parentJobId,j.completedAt??'');}
 for(const v of w.visits)row('visits',v,v.status,[v.notes,'Planned '+v.startAt+' to '+v.endAt+' ('+v.timezone+'); '+v.workerRefs.join(', '),'Actual '+(v.startedAt??'')+' to '+(v.finishedAt??''),...v.events.map(e=>e.action+'; '+(e.reason??e.notes??''))].join('\n'),'',v.startAt);
 for(const f of w.fieldRecords)row('fieldRecords',f,'recorded',[f.notes,...f.measurements.map(m=>m.label+': '+m.value+' '+m.unit+'; '+m.source),...f.checkResults.map(c=>c.checkId+': '+c.result+'; '+c.notes)].join('\n'),f.visitId,f.recordedAt,f.attachmentIds);
 for(const f of w.findings)row('findings',f,f.status,[f.severity,f.description,...f.events.map(e=>e.action+' '+e.at+'; '+(e.resolution??e.reason??''))].join('\n'),f.visitId,'',f.evidenceIds);
 for(const p of w.payments)row('payments',p,nCorrected(w,p.id)?'superseded correction':'current',[p.kind,p.amountCents+' '+p.currency+' minor units',p.notes].join('\n'),p.reference,p.paidAt);
 for(const h of w.handovers)row('handovers',h,'preserved edition '+h.edition,h.snapshot.summary,h.reviewSha256,h.snapshot.completedAt,h.snapshot.documentIds);
 for(const p of w.servicePlans)row('servicePlans',p,p.status,[p.reason,p.notes,'Reminder: '+p.notificationStatus,...p.events.map(e=>e.action+' '+e.at+'; '+(e.reason??''))].join('\n'),p.targetJobId,p.dueOn);
 for(const f of w.attachments)row('attachments',f,'retained original',f.description+'\n'+f.bytes+' bytes; '+f.mime,f.sha256,'');
 for(const i of w.imports)row('imports',i,'retained original intake',i.rows.map(r=>r.rowId+': '+r.decision.action+' '+(r.targetId??r.decision.reason??'')).join('\n'),i.attachmentId,i.importedAt,[i.attachmentId]);
 return rows;
}
function nCorrected(w,k){return w.payments.some(x=>x.correctsPaymentId===k);}
function exportCSV(w,operatorKey){validate(w);const keys=['collection','id','operator','site','job','status','title','detail','reference','date','evidence','createdRevision','updatedRevision'],q=x=>'"'+String(x??'').replaceAll('"','""')+'"';return [keys.map(q).join(','),...readableRows(w,operatorKey).map(r=>keys.map(k=>q(r[k])).join(','))].join('\r\n')+'\r\n';}
function reportHTML(w,operatorKey){validate(w);const rows=readableRows(w,operatorKey);return htmlPage('Stove operating register', '<p>Workspace '+esc(w.id)+' · revision '+w.revision+'. This current register distinguishes recorded operating evidence from preserved completed editions. It makes no technical compliance or certificate determination.</p>'+collections.map(c=>{const group=rows.filter(r=>r.collection===c);return group.length?'<section><h2>'+esc(c)+'</h2>'+table(['ID / title','Status','Source / operating detail','Reference / date'],group.map(r=>[r.id+'\n'+r.title,r.status,r.detail+(r.evidence?'\nEvidence: '+r.evidence:''),r.reference+'\n'+r.date]))+'</section>':'';}).join('')+'<p>The complete working JSON retains original files, all recorded revisions, requested/confirmed state and full source mappings.</p>');}
function handoverHTML(w,k){validate(w);const h=ref(w,'handovers',k),s=h.snapshot;return htmlPage('Recorded job handover — '+s.job.title,'<p>Preserved edition '+h.edition+' · '+esc(h.id)+' · '+esc(s.completedAt)+'. This document records the responsible operator’s supplied observations and evidence; it does not issue or authenticate certification.</p><h2>Identity and scope at handover</h2>'+table(['Field','Retained value'],[['Site',s.site.propertyRef+' · '+s.site.address],['Customer reference',s.site.customerRef],['Appliance',s.appliance?[s.appliance.label,s.appliance.makeModel,s.appliance.serialNumber].join(' · '):'Not selected'],['Accepted scope',s.job.scope],['Quote',s.quote?s.quote.id+' · '+s.quote.currency+' '+s.quote.totals.totalCents+' minor units':'No accepted quote linked'],['Summary',s.summary],['Author',s.author],['Correction / notes',s.notes]])+'<h2>Visits</h2>'+table(['Visit','Status','Planned','Actual / notes'],s.visits.map(v=>[v.id,v.status,v.startAt+' – '+v.endAt+' '+v.timezone,(v.startedAt??'')+' – '+(v.finishedAt??'')+'\n'+(v.notes??v.reason??'')]))+'<h2>Recorded field observations</h2>'+table(['Record / author','Time','Observations','Measurements'],s.fieldRecords.map(f=>[f.id+' / '+f.author,f.recordedAt,f.notes,f.measurements.map(m=>m.label+': '+m.value+' '+m.unit+'; '+m.source).join('\n')]))+'<h2>Checklist</h2>'+table(['Check','Recorded result','Notes','Original evidence'],s.checklist.map(c=>[c.label,c.result,c.notes,c.evidenceIds.join(', ')]))+'<h2>Findings at this edition</h2>'+table(['Finding','Severity / status','Description','Resolution history'],s.findings.map(f=>[f.id,f.severity+' / '+f.status,f.description,f.events.map(e=>e.action+': '+(e.resolution??e.reason??'')).join('\n')]))+'<h2>Documents and acknowledgements</h2>'+table(['Requirement','Recorded status','Reference','Notes'],s.requirements.map(r=>[r.label,r.status,r.reference,r.notes]))+'<p>Customer acknowledgement: '+esc(s.customerAcknowledgement?canonical(s.customerAcknowledgement):'Not recorded')+'</p><h2>Recorded payments</h2>'+table(['Entry','Type / amount','Original reference','Correction'],s.payments.map(p=>[p.id,p.kind+' '+p.amountCents+' '+p.currency+' minor units',p.reference,p.correctsPaymentId??'']))+'<p>Recorded receipts '+s.money.receivedCents+'; refunds '+s.money.refundedCents+'; balance '+esc(s.money.balanceCents===null?'not quoted':s.money.balanceCents)+' minor units.</p><h2>Selected original documents</h2><ul>'+fileLinks(w,s.documentIds)+'</ul><p>Frozen snapshot SHA-256: '+esc(h.snapshotSha256)+'. Later source amendments and new findings do not rewrite this edition.</p>');}

return {VERSION,MAX_FILE,MAX_WORKSPACE,create,mutate,validate,exportWorkspace,importWorkspace,uid,hash,canonical,bytes,base64,decode,summary,jobView,siteView,visitView,dayPlan,quoteView,reviewSurvey,reviewQuote,reviewVisit,reviewHandover,reviewImport,reportHTML,exportCSV,handoverHTML,attachmentBytes:(w,k)=>unbase64(ref(w,'attachments',k).base64)};
});
