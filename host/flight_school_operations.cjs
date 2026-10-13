(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./connected_sha256.cjs'));else root.FlightSchoolOperations=factory(root.FlightSchoolOperationsHash);})(typeof globalThis!=='undefined'?globalThis:this,function(H){
'use strict';
const SCHEMA='commons.flight-school-operations.v1';
const COLLECTIONS=['students','aircraft','instructors','bookings','observations','reviews','deposits','allocations','refunds','ledger','pay_entries','progress','maintenance','qualifications','mappings','imports'];
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=(message)=>{throw new Error(message);};
const need=(v,m)=>{if(!v)fail(m);};
const text=v=>v===undefined||v===null?'':String(v).trim();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function id(v,label='ID'){v=text(v);need(v&&v.length<=160&&!['__proto__','prototype','constructor'].includes(v),label+' is required.');return v;}
function num(v,label,min=0){need(Number.isSafeInteger(v)&&v>=min,label+' must be an integer of at least '+min+'.');return v;}
function optionalInt(v,label,min=0){return v===null||v===undefined||v===''?null:num(Number(v),label,min);}
function choose(v,choices,label){need(choices.includes(v),label+' must be one of '+choices.join(', ')+'.');return v;}
function date(v,label='Date',optional=false){if(optional&&!v)return '';need(/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v,label+' must be a valid YYYY-MM-DD date.');return v;}
function instant(v,label='Time'){need(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v)),label+' must include an actual timezone offset.');return v;}
function meter(v){if(v===null||v===undefined||v==='')return null;v=String(v);need(/^\d+(?:\.\d{1,3})?$/.test(v)&&Number(v)<=100000000,'Meter must be nonnegative hours with up to three decimals.');return v;}
const find=(r,c,k)=>{const x=r[c].find(x=>x.id===k);need(x,'Unknown '+c+' record: '+k);return x;};
const maybe=(r,c,k)=>r[c].find(x=>x.id===k);
function put(r,c,row){const i=r[c].findIndex(x=>x.id===row.id);if(i<0)r[c].push(row);else r[c][i]=row;return row;}
function hash(x){return H.sha256Utf8(typeof x==='string'?x:JSON.stringify(x)).sha256;}
function money(n){return n===null||n===undefined?'':(n/100).toFixed(2);}
function parseMoney(s){need(/^\d+(?:\.\d{1,2})?$/.test(String(s)),'Money requires a nonnegative decimal with at most two places.');const [a,b='']=String(s).split('.');return num(Number(a)*100+Number(b.padEnd(2,'0')),'Money');}
function roundRatio(n,d,mode){need(Number.isSafeInteger(n)&&Number.isSafeInteger(d)&&d>0,'The amount exceeds supported exact arithmetic.');if(mode==='half_up')return Math.floor((n+Math.floor(d/2))/d);if(mode==='floor')return Math.floor(n/d);if(mode==='ceil')return Math.ceil(n/d);return null;}
function billedMinutes(v,s){if(v===null)return null;if(s.rounding_mode==='unresolved'||!s.rounding_minutes)return null;const q=v/s.rounding_minutes;return (s.rounding_mode==='up'?Math.ceil(q):s.rounding_mode==='down'?Math.floor(q):Math.floor(q+0.5))*s.rounding_minutes;}
const issue=(id,text)=>({id,text});
function cleanSource(source){const s=clone(source);delete s.private_originals;need(s.schema==='commons.flight-school-source.v1'&&Array.isArray(s.rates),'A complete flight-school source is required.');return s;}
function create(source){source=cleanSource(source);const r={schema:SCHEMA,version:1,id:source.id,source,source_sha256:hash(source),revision:0,settings:{currency:source.currency||'USD',aircraft_clock:'unresolved',rounding_mode:'unresolved',rounding_minutes:null,money_rounding:'unresolved',tax_bps:null,tax_note:'',deposit_rounding:'unresolved',promo_eligibility:'unresolved',preflight_items:[],note:''},rate_decisions:[],history:[]};if(typeof r.settings.currency!=='string')r.settings.currency='USD';for(const c of COLLECTIONS)r[c]=[];return r;}
function validateRecord(r){need(r&&r.schema===SCHEMA&&r.version===1,'Unsupported flight-school record.');need(r.source_sha256===hash(r.source),'Original source digest does not match.');need(!own(r.source,'private_originals'),'Private source attachment references do not belong in the customer record.');num(r.revision,'Revision');need(Array.isArray(r.history)&&r.history.length===r.revision,'Complete history is required.');for(const c of [...COLLECTIONS,'rate_decisions']){need(Array.isArray(r[c]),'Missing '+c+'.');const ids=new Set();for(const x of r[c]){id(x.id);need(!ids.has(x.id),'Duplicate '+c+' ID '+x.id);ids.add(x.id);}}for(const b of r.bookings){find(r,'students',b.student_id);if(b.aircraft_id)find(r,'aircraft',b.aircraft_id);if(b.instructor_id)find(r,'instructors',b.instructor_id);}for(const d of r.deposits){find(r,'students',d.student_id);num(d.amount_minor,'Deposit amount',1);num(d.promo_minor,'Promotional credit');}for(const a of r.allocations)num(a.amount_minor,'Allocation',1);for(const l of r.ledger)need(Number.isSafeInteger(l.amount_minor),'Ledger money must use integer minor units.');return r;}
function rates(r){const list=r.source.rates.map(x=>({...x,role:x.id.includes('wet')?'aircraft':x.id==='discovery'?'fixed':'instruction',enabled:true,clock:x.id.includes('wet')?'aircraft':'instruction'}));list.push({id:'budget-aircraft-180',label:'Published private budget aircraft alternative',amount_minor:18000,unit:'hour',role:'aircraft',source_id:'609-pricing',enabled:false,clock:'aircraft',notes:'Historical budget choice; office must explicitly select with a reason.'},{id:'professional-dual-255',label:'Professional programme compound dual',amount_minor:25500,unit:'hour',role:'dual',source_id:'609-professional',enabled:false,clock:'aircraft',notes:'Includes aircraft and instruction for the same dual time; do not add separate aircraft or instruction.'});return list.map(x=>{const d=r.rate_decisions.find(d=>d.id===x.id);return {...x,...(d?{amount_minor:d.amount_minor,enabled:d.enabled}:{}),source_url:(r.source.sources.find(s=>s.id===x.source_id)||{}).url||'',original:clone(x),decision:d||null};});}
function catalogue(r){validateRecord(r);return rates(r);}
function tariff(r){return hash({settings:r.settings,rates:rates(r).map(x=>({id:x.id,amount_minor:x.amount_minor,enabled:x.enabled}))});}
function compute(r,input,snapshot,actual){
 const s=clone(snapshot?snapshot.settings_snapshot:r.settings), rr=snapshot?snapshot.rate_snapshot:rates(r), problems=[],lines=[];
 const selected=(input.lines||[]).map(l=>{const rate=rr.find(x=>x.id===l.rate_id);need(rate,'Unknown rate '+l.rate_id);return {l,rate};});
 if(!selected.length)problems.push(issue('lines','Add at least one charge line.'));
 const seen=new Set();let dual=false,other=false;
 for(const {l,rate} of selected){id(l.id,'Charge line ID');need(!seen.has(l.id),'Charge line IDs must be unique.');seen.add(l.id);
 if(!rate.enabled)problems.push(issue(l.id,'Selected rate is disabled.'));
 if(rate.role==='dual')dual=true;if(['aircraft','instruction'].includes(rate.role))other=true;
 if(input.kind==='ground'&&rate.role!=='instruction')problems.push(issue(l.id,'Ground bookings use instruction rates only.'));
 if(input.kind==='owner_aircraft'&&['aircraft','dual'].includes(rate.role))problems.push(issue(l.id,'Owner-aircraft bookings must not add a school aircraft charge.'));
 if(input.kind==='solo'&&['dual','instruction'].includes(rate.role))problems.push(issue(l.id,'A solo booking cannot include dual instruction.'));
 if(rate.id==='owner-aircraft-cfi'&&input.kind!=='owner_aircraft')problems.push(issue(l.id,'The owner-aircraft instruction rate requires that booking kind.'));
 let mins=rate.unit==='hour'?optionalInt(l.minutes,'Planned minutes'):null,qty=rate.unit==='flight'?num(Number(l.quantity||1),'Flight quantity',1):null;
 if(actual&&rate.unit==='hour')mins=['aircraft','dual'].includes(rate.role)?actual.aircraft_minutes:input.kind==='ground'?actual.ground_minutes:actual.instruction_minutes;
 const bm=rate.unit==='hour'?billedMinutes(mins,s):null;
 let amount=null;
 if(rate.amount_minor===null)problems.push(issue(l.id,'Rate amount needs an office choice.'));
 else if(rate.unit==='hour'&&(mins===null||bm===null))problems.push(issue(l.id,'Actual/planned minutes and reviewed rounding are required.'));
 else amount=roundRatio(rate.amount_minor*(rate.unit==='hour'?bm:qty),rate.unit==='hour'?60:1,s.money_rounding);
 if(amount===null)problems.push(issue(l.id,'Select reviewed monetary rounding.'));
 lines.push({id:l.id,rate_id:rate.id,label:rate.label,role:rate.role,unit:rate.unit,minutes:mins,billed_minutes:bm,quantity:qty,rate_minor:rate.amount_minor,amount_minor:amount});
 }
 if(dual&&other)problems.push(issue('compound-dual','Compound dual already includes aircraft and instruction; separate aircraft/instruction lines would double charge.'));
 const roles=lines.map(l=>l.role);
 if(new Set(roles).size!==roles.length)problems.push(issue('duplicate-role','Use one line per billing role in a booking; repeated role lines would duplicate the same actual clock.'));
 if(roles.some(x=>['aircraft','dual'].includes(x))&&s.aircraft_clock==='unresolved')problems.push(issue('clock','The school must select the actual aircraft billing clock.'));
 const subtotal=lines.reduce((n,l)=>n+(l.amount_minor||0),0);
 const tax=s.tax_bps===null?null:roundRatio(subtotal*s.tax_bps,10000,s.money_rounding);
 if(tax===null)problems.push(issue('tax','Reviewed tax and monetary rounding are required, including an explicit zero tax where appropriate.'));
 return {lines,subtotal_minor:subtotal,tax_minor:tax,total_minor:tax===null?null:subtotal+tax,complete:problems.length===0,issues:problems,tariff_sha256:snapshot?snapshot.tariff_sha256:tariff(r),settings_snapshot:s,rate_snapshot:clone(rr)};
}
function quote(r,input){validateRecord(r);return compute(r,input);}
function overlaps(a,b){return Date.parse(a.starts_at)<Date.parse(b.ends_at)&&Date.parse(b.starts_at)<Date.parse(a.ends_at);}
function conflicts(r,b){return r.bookings.filter(x=>x.id!==b.id&&!['Cancelled','Closed','Posted'].includes(x.status)&&overlaps(x,b)&&(['student_id','aircraft_id','instructor_id'].some(k=>b[k]&&b[k]===x[k]))).map(x=>({id:x.id,starts_at:x.starts_at,ends_at:x.ends_at,resources:['student_id','aircraft_id','instructor_id'].filter(k=>b[k]&&b[k]===x[k])}));}
function readiness(r,bookingId){validateRecord(r);const b=find(r,'bookings',bookingId),p=[],q=b.quote||compute(r,b),cf=conflicts(r,b);
 if(find(r,'students',b.student_id).status!=='active')p.push(issue('student','Student is inactive.'));
 if(b.kind!=='ground'&&!b.aircraft_id)p.push(issue('aircraft','Choose an actual aircraft.'));
 if(b.aircraft_id){const a=find(r,'aircraft',b.aircraft_id);if(a.status!=='available')p.push(issue('aircraft','Aircraft is not marked available by the school.'));if(r.maintenance.some(m=>m.aircraft_id===a.id&&m.status==='open'))p.push(issue('maintenance','Aircraft has an open maintenance observation.'));if(b.kind==='owner_aircraft'&&a.ownership!=='owner')p.push(issue('ownership','Owner-aircraft instruction requires an owner aircraft record.'));}
 if(b.kind!=='solo'&&!b.instructor_id)p.push(issue('instructor','Select the responsible instructor.'));
 if(b.instructor_id&&find(r,'instructors',b.instructor_id).status!=='active')p.push(issue('instructor','Instructor is inactive.'));
 if(cf.length)p.push(issue('conflict','A student, aircraft or instructor overlaps another booking.'));
 for(const x of q.issues)p.push(x);
 return {booking_id:b.id,status:b.status,ready:p.length===0,issues:p,quote:q,conflicts:cf};
}
function latestObservation(r,b){return r.observations.filter(o=>o.booking_id===b.id&&!o.superseded).slice(-1)[0]||null;}
function actualMinutes(b,o){const s=b.dispatch.quote.settings_snapshot;let aircraft=null;
 if(s.aircraft_clock==='manual')aircraft=o.flight_minutes;
 if(s.aircraft_clock==='elapsed')aircraft=(Date.parse(o.landed_at)-Date.parse(b.dispatch.actual_at))/60000;
 if(s.aircraft_clock==='hobbs'||s.aircraft_clock==='tach'){const k=s.aircraft_clock,start=b.dispatch[k+'_start'],end=o[k+'_end'];if(start!==null&&end!==null)aircraft=(Math.round(Number(end)*1000)-Math.round(Number(start)*1000))*60/1000;}
 return {aircraft_minutes:aircraft,instruction_minutes:o.instruction_minutes,ground_minutes:o.ground_minutes};
}
function estimate(r,b){const o=latestObservation(r,b);if(!o)return {...(b.quote||compute(r,b)),booking_id:b.id,observation_id:'',complete:false,issues:[issue('observation','Actual flight observations are required.')],pay_minor:null,pay_complete:false,reviewed:false,instructor_reviewed:false,office_reviewed:false,tariff_changed:!!b.quote&&b.quote.tariff_sha256!==tariff(r)};
 const q=compute(r,b,b.dispatch.quote,actualMinutes(b,o)),fp=b.dispatch.instructor_pay;let pay=null,payok=!b.instructor_id;
 if(fp){const minutes=fp.pay_basis==='manual'?o.pay_minutes:(o.instruction_minutes===null?null:o.instruction_minutes+(o.ground_minutes||0));if(fp.pay_rate_minor!==null&&minutes!==null){pay=roundRatio(fp.pay_rate_minor*minutes,60,b.dispatch.quote.settings_snapshot.money_rounding);payok=pay!==null;}}
 const sh=hash(o),approved=role=>r.reviews.some(v=>v.booking_id===b.id&&v.observation_sha256===sh&&v.role===role&&v.decision==='approved'&&!v.superseded);
 const ir=approved('instructor'),or=approved('office');
 return {...q,booking_id:b.id,observation_id:o.id,observation_sha256:sh,pay_minor:pay,pay_complete:payok,reviewed:ir&&or,instructor_reviewed:ir,office_reviewed:or,tariff_changed:b.dispatch.quote.tariff_sha256!==tariff(r)};
}
function flightEstimate(r,bookingId){validateRecord(r);return estimate(r,find(r,'bookings',bookingId));}
function activeAllocations(r){return r.allocations.filter(a=>!a.reversed);}
function activeRefunds(r){return r.refunds.filter(x=>!x.reversed);}
function lotRows(r,studentId,on){const aa=activeAllocations(r),rf=activeRefunds(r),rows=[];for(const d of r.deposits.filter(d=>d.student_id===studentId)){for(const kind of ['cash','promo']){const amount=kind==='cash'?d.amount_minor:d.promo_minor;if(!amount&&kind==='promo')continue;const lid=d.id+':'+kind,used=aa.filter(a=>a.lot_id===lid).reduce((s,a)=>s+a.amount_minor,0),refunded=rf.filter(a=>a.lot_id===lid).reduce((s,a)=>s+a.amount_minor,0),expired=kind==='promo'&&!!d.expires_on&&!!on&&on>=d.expires_on;rows.push({id:lid,deposit_id:d.id,kind,student_id:d.student_id,amount_minor:amount,used_minor:used,refunded_minor:refunded,available_minor:d.voided||expired?0:amount-used-refunded,expires_on:kind==='promo'?d.expires_on:'',expired,voided:!!d.voided,promo_eligibility:d.promo_eligibility});}}return rows;}
function account(r,studentId,on){validateRecord(r);find(r,'students',studentId);if(on)date(on);const lots=lotRows(r,studentId,on),aa=activeAllocations(r),charges=r.ledger.filter(l=>l.student_id===studentId&&l.kind==='charge').map(l=>{const allocated=aa.filter(a=>a.ledger_id===l.id).reduce((s,a)=>s+a.amount_minor,0);return {...l,allocated_minor:allocated,outstanding_minor:l.reversed?0:l.amount_minor-allocated};});return {student_id:studentId,cash_available_minor:lots.filter(l=>l.kind==='cash').reduce((s,l)=>s+l.available_minor,0),promo_available_minor:lots.filter(l=>l.kind==='promo').reduce((s,l)=>s+l.available_minor,0),outstanding_minor:charges.reduce((s,l)=>s+l.outstanding_minor,0),lots,charges};}
function depositPreview(r,input){validateRecord(r);const amount=num(Number(input.amount_minor),'Deposit amount',1),tier=r.source.deposit_match_tiers.find(t=>amount>=t.lower_minor&&amount<=t.upper_minor)||null,issues=[];let promo=0;if(input.match){if(!tier)issues.push(issue('tier','No literal published deposit tier covers this exact amount.'));else{promo=roundRatio(amount*tier.percent,100,r.settings.deposit_rounding);if(promo===null)issues.push(issue('rounding','The school must select promotional-credit monetary rounding.'));}if(r.settings.promo_eligibility==='unresolved')issues.push(issue('eligibility','Select and record promotional-credit eligibility.'));}return {amount_minor:amount,tier:tier?clone(tier):null,promo_minor:promo,complete:!issues.length,issues};}
function programmeProgress(r,studentId){validateRecord(r);find(r,'students',studentId);return {student_id:studentId,programmes:clone(r.source.programmes),professional_programme:clone(r.source.professional_programme),observations:clone(r.progress.filter(p=>p.student_id===studentId)),qualifications:clone(r.qualifications.filter(q=>q.subject_type==='student'&&q.subject_id===studentId))};}

function execute(r,type,i,actor,at){
 const note=()=>{need(text(i.note),'A recorded reason or review note is required.');return text(i.note);};
 const noPosted=(b)=>need(!['Posted','Closed'].includes(b.status),'Reverse the existing posted flight before changing its actual observations.');
 if(type==='settings.save'){
  const s={...r.settings};for(const k of ['currency','aircraft_clock','rounding_mode','rounding_minutes','money_rounding','tax_bps','tax_note','deposit_rounding','promo_eligibility','preflight_items'])if(own(i,k))s[k]=clone(i[k]);
  need(s.currency===r.settings.currency,'Use a separate school record for another currency; existing money must not be relabelled.');
  choose(s.aircraft_clock,['unresolved','hobbs','tach','elapsed','manual'],'Aircraft clock');choose(s.rounding_mode,['unresolved','nearest','up','down'],'Rounding mode');
  s.rounding_minutes=optionalInt(s.rounding_minutes,'Minute increment',1);for(const k of ['money_rounding','deposit_rounding'])choose(s[k],['unresolved','half_up','floor','ceil'],k);
  s.tax_bps=optionalInt(s.tax_bps,'Tax basis points');need(s.tax_bps===null||s.tax_bps<=10000,'Tax exceeds supported range.');if(s.tax_bps!==null)need(text(s.tax_note),'Record the tax decision, including a zero-rate choice.');
  choose(s.promo_eligibility,['unresolved','all_training','aircraft_only'],'Promotional eligibility');need(Array.isArray(s.preflight_items),'Checklist must be an array.');
  const ids=new Set();s.preflight_items=s.preflight_items.map(x=>{const k=id(x.id);need(!ids.has(k),'Checklist IDs must be unique.');ids.add(k);need(text(x.label),'Checklist label is required.');return {id:k,label:text(x.label),required:!!x.required};});
  s.note=note();s.reviewed_by=actor;s.reviewed_at=at;r.settings=s;return;
 }
 if(type==='rate.save'||type==='rate.restore'){
  const rate=rates(r).find(x=>x.id===i.id);need(rate,'Unknown source rate.');note();
  if(type==='rate.restore'){r.rate_decisions=r.rate_decisions.filter(x=>x.id!==i.id);return;}
  const old=rate.decision||{amount_minor:rate.amount_minor,enabled:rate.enabled};put(r,'rate_decisions',{id:i.id,amount_minor:own(i,'amount_minor')?optionalInt(i.amount_minor,'Rate'):old.amount_minor,enabled:own(i,'enabled')?!!i.enabled:old.enabled,note:i.note,by:actor,at});return;
 }
 if(type==='student.save'){const k=id(i.id),old=maybe(r,'students',k)||{};need(text(i.name),'Student name is required.');if(i.programme_id)need(r.source.programmes.some(p=>p.id===i.programme_id)||i.programme_id==='professional','Unknown source programme.');put(r,'students',{...old,id:k,name:text(i.name),email:text(i.email),phone:text(i.phone),programme_id:text(i.programme_id),status:choose(i.status||'active',['active','inactive'],'Student status'),note:text(i.note)});return;}
 if(type==='aircraft.save'){const k=id(i.id);need(text(i.registration),'Enter the actual registration or owner identifier.');need(!r.aircraft.some(a=>a.id!==k&&a.registration.toUpperCase()===text(i.registration).toUpperCase()),'Aircraft registration already exists.');if(i.type_id)need(r.source.aircraft_types.some(a=>a.id===i.type_id),'Unknown published aircraft type.');put(r,'aircraft',{id:k,registration:text(i.registration),type_id:text(i.type_id),ownership:choose(i.ownership||'school',['school','owner'],'Ownership'),status:choose(i.status||'inactive',['available','maintenance','inactive'],'Aircraft status'),hobbs:meter(i.hobbs),tach:meter(i.tach),note:note(),reviewed_by:actor,reviewed_at:at});return;}
 if(type==='instructor.save'){const k=id(i.id);need(text(i.name),'Instructor name is required.');put(r,'instructors',{id:k,name:text(i.name),status:choose(i.status||'active',['active','inactive'],'Instructor status'),pay_rate_minor:optionalInt(i.pay_rate_minor,'Instructor compensation'),pay_basis:choose(i.pay_basis||'instruction_minutes',['instruction_minutes','manual'],'Pay basis'),note:text(i.note)});return;}
 if(type==='booking.save'){
  const k=id(i.id),old=maybe(r,'bookings',k);if(old)need(['Draft','Approved'].includes(old.status),'Cancel or finish the existing dispatched booking before editing its schedule.');
  find(r,'students',i.student_id);if(i.aircraft_id)find(r,'aircraft',i.aircraft_id);if(i.instructor_id)find(r,'instructors',i.instructor_id);
  const b={id:k,student_id:i.student_id,aircraft_id:text(i.aircraft_id),instructor_id:text(i.instructor_id),starts_at:instant(i.starts_at),ends_at:instant(i.ends_at),kind:choose(i.kind,['dual','solo','ground','discovery','owner_aircraft'],'Booking kind'),lines:clone(i.lines||[]),purpose:text(i.purpose),note:text(i.note),status:old?old.status:'Draft',approval:old?old.approval:null,quote:old?old.quote:null,dispatch:old?old.dispatch:null};
  need(Date.parse(b.ends_at)>Date.parse(b.starts_at),'Booking end must follow start.');
  const pricing=x=>JSON.stringify({student_id:x.student_id,aircraft_id:x.aircraft_id,instructor_id:x.instructor_id,starts_at:x.starts_at,ends_at:x.ends_at,kind:x.kind,lines:x.lines});
  if(old&&old.status==='Approved'&&pricing(old)!==pricing(b))need(i.reprice===true,'Explicitly reprice to change an approved booking or its schedule.');
  if(!old||old.status==='Draft'||i.reprice){b.quote=compute(r,b);b.approval=null;b.status='Draft';}else b.quote=old.quote;
  put(r,'bookings',b);return;
 }
 if(type==='booking.approve'){
  const b=find(r,'bookings',i.id);need(b.status==='Draft','Only a draft booking can be approved.');const ready=readiness(r,b.id);need(ready.ready,ready.issues.map(x=>x.text).join(' '));
  const rows=i.school_review||[];for(const k of ['student_authorization','aircraft_status','instructor_assignment']){const v=rows.find(x=>x.id===k);need(v&&v.status==='confirmed'&&text(v.evidence),'Record actual school review and evidence for '+k+'.');}
  b.approval={actor,at,note:note(),school_review:clone(rows)};b.status='Approved';return;
 }
 if(type==='booking.cancel'){const b=find(r,'bookings',i.id);need(['Draft','Approved'].includes(b.status),'An actual dispatched flight cannot be cancelled as a booking.');b.status='Cancelled';b.cancellation={actor,at,note:note()};return;}
 if(type==='booking.dispatch'){
  const b=find(r,'bookings',i.id);need(b.status==='Approved'&&b.approval,'Office approval is required.');const rd=readiness(r,b.id);need(rd.ready,rd.issues.map(x=>x.text).join(' '));const actual=instant(i.actual_at,'Actual dispatch time');
  const active=r.bookings.find(x=>x.id!==b.id&&x.dispatch&&['Dispatched','Observed','Reviewed'].includes(x.status)&&['student_id','aircraft_id','instructor_id'].some(k=>b[k]&&b[k]===x[k]));need(!active,'A selected resource has an unfinished dispatch.');
  const actualWindow={...b,starts_at:actual,ends_at:new Date(Date.parse(actual)+(Date.parse(b.ends_at)-Date.parse(b.starts_at))).toISOString()};need(!conflicts(r,actualWindow).length,'Actual departure overlaps another reserved resource.');
  const checklist=b.quote.settings_snapshot.preflight_items;need(checklist.length,'The school must enter and review its actual preflight checklist before approving this tariff. Reprice the booking after updating settings.');
  const checks=i.preflight||[];for(const c of checklist){const q=checks.find(x=>x.id===c.id);need(q,'Record the actual result for '+c.label+'.');choose(q.status,['confirmed','not_applicable','unresolved'],'Preflight result');need(!c.required||q.status==='confirmed','Required preflight item is unresolved: '+c.label);need(q.status!=='not_applicable'||text(q.note),'Explain any not-applicable checklist item.');}
  const hs=meter(i.hobbs_start),ts=meter(i.tach_start),clock=b.quote.settings_snapshot.aircraft_clock;if(b.quote.lines.some(l=>['aircraft','dual'].includes(l.role))){if(clock==='hobbs')need(hs!==null,'Actual starting Hobbs is required.');if(clock==='tach')need(ts!==null,'Actual starting Tach is required.');}
  b.dispatch={actual_at:actual,by:actor,recorded_at:at,preflight:clone(checks),hobbs_start:hs,tach_start:ts,quote:clone(b.quote),instructor_pay:b.instructor_id?clone(find(r,'instructors',b.instructor_id)):null,note:note()};b.status='Dispatched';return;
 }
 if(type==='dispatch.correct'){const b=find(r,'bookings',i.booking_id);need(b.dispatch,'No dispatch to correct.');noPosted(b);note();if(own(i,'actual_at'))b.dispatch.actual_at=instant(i.actual_at);for(const k of ['hobbs_start','tach_start'])if(own(i,k))b.dispatch[k]=meter(i[k]);const o=latestObservation(r,b);if(o){need(Date.parse(o.landed_at)>=Date.parse(b.dispatch.actual_at),'Corrected departure follows recorded completion.');for(const c of ['hobbs','tach'])if(o[c+'_end']!==null&&b.dispatch[c+'_start']!==null)need(Number(o[c+'_end'])>=Number(b.dispatch[c+'_start']),'Corrected meter start exceeds actual end.');}b.dispatch.correction={actor,at,note:i.note};for(const v of r.reviews.filter(v=>v.booking_id===b.id))v.superseded=true;b.status=o?'Observed':'Dispatched';return;}
 if(type==='pay.review'){const b=find(r,'bookings',i.booking_id);need(b.dispatch&&b.instructor_id,'No dispatched instructor compensation to review.');noPosted(b);b.dispatch.instructor_pay={...b.dispatch.instructor_pay,pay_rate_minor:num(Number(i.pay_rate_minor),'Reviewed instructor rate'),pay_basis:choose(i.pay_basis,['instruction_minutes','manual'],'Compensation basis'),review:{actor,at,note:note()}};for(const v of r.reviews.filter(v=>v.booking_id===b.id&&v.role==='office'))v.superseded=true;if(latestObservation(r,b))b.status='Observed';return;}
 if(type==='observation.save'){
  const b=find(r,'bookings',i.booking_id);need(b.dispatch,'A recorded dispatch is required.');noPosted(b);need(['Dispatched','Observed','Reviewed'].includes(b.status),'Flight is not open for actual observations.');
  const o={id:id(i.id),booking_id:b.id,landed_at:instant(i.landed_at,'Actual completion time'),hobbs_end:meter(i.hobbs_end),tach_end:meter(i.tach_end),flight_minutes:optionalInt(i.flight_minutes,'Actual flight minutes'),instruction_minutes:optionalInt(i.instruction_minutes,'Instruction minutes'),ground_minutes:optionalInt(i.ground_minutes,'Ground instruction minutes'),pay_minutes:optionalInt(i.pay_minutes,'Instructor compensation minutes'),note:note(),actor,at,superseded:false};
  need(Date.parse(o.landed_at)>=Date.parse(b.dispatch.actual_at),'Actual completion precedes dispatch.');
  for(const c of ['hobbs','tach'])if(o[c+'_end']!==null&&b.dispatch[c+'_start']!==null)need(Number(o[c+'_end'])>=Number(b.dispatch[c+'_start']),c+' meter decreased; record a corrected start or reviewed meter replacement outside this flight before billing.');
  const old=maybe(r,'observations',o.id);need(!old||old.booking_id===b.id,'Observation ID belongs to another booking.');
  for(const x of r.observations.filter(x=>x.booking_id===b.id&&x.id!==o.id))x.superseded=true;for(const v of r.reviews.filter(v=>v.booking_id===b.id))v.superseded=true;
  put(r,'observations',o);b.status='Observed';return;
 }
 if(type==='flight.review'){
  const b=find(r,'bookings',i.booking_id);noPosted(b);const o=latestObservation(r,b);need(o,'Record actual flight observations first.');
  const role=choose(i.role,['instructor','office'],'Review role'),decision=choose(i.decision,['approved','returned'],'Decision');note();
  if(decision==='approved'){const e=estimate(r,b);need(e.complete,e.issues.map(x=>x.text).join(' '));if(role==='office')need(e.pay_complete,'Enter a reviewed instructor compensation basis before office approval. It is separate from student billing.');}
  for(const v of r.reviews.filter(v=>v.booking_id===b.id&&v.role===role))v.superseded=true;
  r.reviews.push({id:b.id+':review:'+(r.reviews.length+1),booking_id:b.id,observation_sha256:hash(o),role,decision,note:i.note,actor,at,superseded:false});const e=estimate(r,b);b.status=e.reviewed?'Reviewed':'Observed';return;
 }
 if(type==='flight.post'){
  const b=find(r,'bookings',i.booking_id);need(b.status==='Reviewed','Instructor and office review are required.');const e=estimate(r,b);need(e.complete&&e.reviewed&&e.pay_complete,'Reviewed actual flight and compensation are incomplete.');need(!r.ledger.some(l=>l.booking_id===b.id&&l.kind==='charge'&&!l.reversed),'This flight already has an active posting.');
  const k=b.id+':charge:'+(r.ledger.filter(l=>l.booking_id===b.id&&l.kind==='charge').length+1),entry={id:k,kind:'charge',booking_id:b.id,student_id:b.student_id,amount_minor:e.total_minor,calculation:clone(e),actor,at,note:note(),reversed:false};r.ledger.push(entry);
  if(b.instructor_id)r.pay_entries.push({id:k+':pay',ledger_id:k,booking_id:b.id,instructor_id:b.instructor_id,amount_minor:e.pay_minor,basis:clone(b.dispatch.instructor_pay),observation_id:e.observation_id,actor,at,reversed:false});
  b.ledger_id=k;b.status='Posted';return;
 }
 if(type==='flight.reverse'){
  const b=find(r,'bookings',i.booking_id);need(['Posted','Closed'].includes(b.status),'No active posted flight to reverse.');const l=find(r,'ledger',b.ledger_id);need(!l.reversed,'Flight posting is already reversed.');note();l.reversed=true;l.reversed_by=actor;l.reversed_at=at;l.reversal_note=i.note;
  r.ledger.push({id:l.id+':reversal',kind:'reversal',reverses:l.id,booking_id:b.id,student_id:b.student_id,amount_minor:-l.amount_minor,actor,at,note:i.note});
  for(const a of r.allocations.filter(a=>a.ledger_id===l.id&&!a.reversed)){a.reversed=true;a.reversal={actor,at,note:i.note};}
  for(const p of r.pay_entries.filter(p=>p.ledger_id===l.id&&!p.reversed)){p.reversed=true;r.pay_entries.push({id:p.id+':reversal',ledger_id:l.id,booking_id:b.id,instructor_id:p.instructor_id,amount_minor:-p.amount_minor,reverses:p.id,actor,at,note:i.note});}
  for(const v of r.reviews.filter(v=>v.booking_id===b.id))v.superseded=true;b.status='Observed';return;
 }
 if(type==='flight.close'){const b=find(r,'bookings',i.booking_id);need(b.status==='Posted','Post reviewed billing before closing.');b.status='Closed';b.closed={actor,at,note:note()};return;}
 if(type==='deposit.add'){
  const k=id(i.id);need(!maybe(r,'deposits',k),'Deposit ID already exists; use a reversal instead of overwriting an actual receipt.');find(r,'students',i.student_id);const p=depositPreview(r,i);need(p.complete,p.issues.map(x=>x.text).join(' '));date(i.received_on,'Receipt date');need(text(i.reference),'Actual payment reference is required.');const expires=date(i.expires_on,'Promotional first-unavailable date',true);need(!expires||expires>i.received_on,'Credit expiry must follow receipt.');
  r.deposits.push({id:k,student_id:i.student_id,amount_minor:p.amount_minor,promo_minor:p.promo_minor,received_on:i.received_on,reference:text(i.reference),payment_method:text(i.payment_method),match:!!i.match,tier:p.tier,expires_on:expires,promo_eligibility:r.settings.promo_eligibility,rounding:r.settings.deposit_rounding,note:note(),actor,at,voided:false});return;
 }
 if(type==='deposit.void'){
  const d=find(r,'deposits',i.id);need(!d.voided,'Receipt already voided.');need(!r.allocations.some(a=>a.lot_id.startsWith(d.id+':')&&!a.reversed)&&!r.refunds.some(a=>a.lot_id.startsWith(d.id+':')&&!a.reversed),'Reverse the receipt allocations/refunds before voiding.');d.voided=true;d.void={actor,at,note:note()};return;
 }
 if(type==='allocation.add'){
  const k=id(i.id);need(!maybe(r,'allocations',k),'Allocation ID already exists.');date(i.on);const acct=account(r,i.student_id,i.on),lot=acct.lots.find(l=>l.id===i.lot_id),charge=acct.charges.find(l=>l.id===i.ledger_id);
  need(lot&&!lot.voided,'Unknown or voided lot.');need(charge&&!charge.reversed,'Select an active posted charge for the same student.');const amount=num(Number(i.amount_minor),'Allocation',1);need(amount<=lot.available_minor,'Allocation exceeds available lot balance.');need(amount<=charge.outstanding_minor,'Allocation exceeds unpaid charge.');
  const deposit=find(r,'deposits',lot.deposit_id);need(i.on>=deposit.received_on,'Credit cannot be allocated before its actual receipt.');
  if(lot.kind==='promo'&&lot.promo_eligibility==='aircraft_only'){const eligible=charge.calculation.lines.filter(l=>['aircraft'].includes(l.role)).reduce((s,l)=>s+(l.amount_minor||0),0),used=r.allocations.filter(a=>a.ledger_id===charge.id&&!a.reversed&&a.kind==='promo').reduce((s,a)=>s+a.amount_minor,0);need(amount<=eligible-used,'Promotional credit exceeds separately priced aircraft charges. Compound dual is not split without an explicit school decision.');}
  need(lot.kind!=='promo'||lot.promo_eligibility!=='unresolved','Promotional eligibility has not been reviewed.');
  r.allocations.push({id:k,student_id:i.student_id,lot_id:lot.id,kind:lot.kind,ledger_id:charge.id,amount_minor:amount,on:i.on,note:note(),actor,at,reversed:false});return;
 }
 if(type==='allocation.reverse'){const a=find(r,'allocations',i.id);need(!a.reversed,'Allocation already reversed.');a.reversed=true;a.reversal={actor,at,note:note()};return;}
 if(type==='refund.add'){
  const k=id(i.id);need(!maybe(r,'refunds',k),'Refund ID already exists.');const dep=r.deposits.find(d=>i.lot_id===d.id+':cash');need(dep,'Only actual paid cash may be refunded through this action. Promotional credit is distinct.');date(i.on);need(i.on>=dep.received_on,'Refund predates receipt.');const lot=lotRows(r,dep.student_id,i.on).find(l=>l.id===i.lot_id),amount=num(Number(i.amount_minor),'Refund',1);need(!lot.voided&&amount<=lot.available_minor,'Refund exceeds available paid cash.');need(text(i.reference),'Actual refund reference is required.');r.refunds.push({id:k,lot_id:lot.id,student_id:dep.student_id,amount_minor:amount,on:i.on,reference:text(i.reference),note:note(),actor,at,reversed:false});return;
 }
 if(type==='refund.reverse'){const x=find(r,'refunds',i.id);need(!x.reversed,'Refund already reversed.');x.reversed=true;x.reversal={actor,at,note:note()};return;}
 if(type==='qualification.save'){
  const k=id(i.id),st=choose(i.subject_type,['student','instructor','aircraft'],'Subject type');find(r,{student:'students',instructor:'instructors',aircraft:'aircraft'}[st],i.subject_id);need(text(i.kind)&&text(i.reference),'Record the observation kind and its actual document/reference.');put(r,'qualifications',{id:k,subject_type:st,subject_id:i.subject_id,kind:text(i.kind),status:choose(i.status,['recorded','review_due','expired'],'Qualification observation'),observed_on:date(i.observed_on),expires_on:date(i.expires_on,'Expiry',true),reference:text(i.reference),note:note(),actor,at});return;
 }
 if(type==='maintenance.save'){find(r,'aircraft',i.aircraft_id);need(text(i.kind)&&text(i.reference),'Maintenance kind and actual reference are required.');const status=choose(i.status,['open','resolved'],'Maintenance status');if(status==='resolved')date(i.resolved_on,'Resolution date');put(r,'maintenance',{id:id(i.id),aircraft_id:i.aircraft_id,kind:text(i.kind),status,on:date(i.on),resolved_on:date(i.resolved_on,'Resolution date',true),reference:text(i.reference),note:note(),actor,at});return;}
 if(type==='progress.save'){
  find(r,'students',i.student_id);need(r.source.programmes.some(p=>p.id===i.programme_id)||i.programme_id==='professional','Unknown programme.');if(i.phase_id)need(r.source.professional_programme.phases.some(p=>p.id===i.phase_id),'Unknown professional phase.');
  need(text(i.item),'Progress item is required.');const status=choose(i.status,['planned','in_progress','completed','reviewed'],'Progress status');if(['completed','reviewed'].includes(status))need(text(i.evidence),'Completed progress needs actual evidence.');if(status==='reviewed')need(text(i.reviewer),'Record the responsible reviewer.');
  put(r,'progress',{id:id(i.id),student_id:i.student_id,programme_id:i.programme_id,phase_id:text(i.phase_id),item:text(i.item),status,on:date(i.on),minutes:optionalInt(i.minutes,'Observed minutes'),evidence:text(i.evidence),reviewer:text(i.reviewer),note:text(i.note),actor,at});return;
 }
 if(type==='mapping.save'){const entity=choose(i.entity,['students','aircraft','instructors'],'Import entity');need(i.fields&&typeof i.fields==='object'&&!Array.isArray(i.fields),'Choose a source column for each neutral target field.');const allowed=transferFields(entity);for(const [k,v] of Object.entries(i.fields)){need(allowed.includes(k),'Unknown target field '+k);need(typeof v==='string','Column names must be text.');}put(r,'mappings',{id:id(i.id),entity,fields:clone(i.fields),defaults:clone(i.defaults||{}),note:note(),actor,at});return;}
 if(type==='import.receive'){
  const k=id(i.id);need(!maybe(r,'imports',k),'Import ID already exists.');const p=previewImport(r,i);need(!p.errors.length,p.errors.map(x=>'Row '+x.row+': '+x.text).join(' '));
  for(const row of p.rows.filter(x=>x.action==='create'))execute(r,({students:'student',aircraft:'aircraft',instructors:'instructor'}[p.entity])+'.save',row.value,actor,at);
  r.imports.push({id:k,mapping_id:i.mapping_id,filename:text(i.filename),source_text:typeof i.source_text==='string'?i.source_text:'',source_rows:clone(i.rows),source_sha256:hash({source_text:i.source_text||'',rows:i.rows}),entity:p.entity,decisions:p.rows.map(x=>({row:x.row,id:x.value.id,action:x.action})),created:p.rows.filter(x=>x.action==='create').length,skipped:p.rows.filter(x=>x.action==='skip').length,note:note(),actor,at});return;
 }
 fail('Unknown operation '+type);
}
function transferFields(entity){const fields={students:['id','name','email','phone','programme_id','status','note'],aircraft:['id','registration','type_id','ownership','status','hobbs','tach','note'],instructors:['id','name','status','pay_rate_minor','pay_basis','note']};need(fields[entity],'Unsupported import entity.');return fields[entity].slice();}
function previewImport(r,i){validateRecord(r);const m=find(r,'mappings',i.mapping_id);need(Array.isArray(i.rows),'Import requires complete parsed source rows.');const rows=[],errors=[],ids=new Set();const trial=clone(r);for(let n=0;n<i.rows.length;n++){const raw=i.rows[n],value=clone(m.defaults||{});for(const [target,col]of Object.entries(m.fields))if(col&&own(raw,col))value[target]=raw[col];if(own(value,'pay_rate_minor'))value.pay_rate_minor=optionalInt(value.pay_rate_minor,'Instructor compensation');value.id=text(value.id);try{id(value.id);need(!ids.has(value.id),'Duplicate incoming record ID.');ids.add(value.id);const exists=maybe(r,m.entity,value.id);let action=exists?'skip':'create';if(!exists)execute(trial,({students:'student',aircraft:'aircraft',instructors:'instructor'}[m.entity])+'.save',value,'Import preview','2000-01-01T00:00:00Z');rows.push({row:n+1,value,action});}catch(e){errors.push({row:n+1,text:e.message});rows.push({row:n+1,value,action:'review'});}}return {entity:m.entity,rows,errors,created:rows.filter(x=>x.action==='create').length,skipped:rows.filter(x=>x.action==='skip').length};}
function changes(before,after){const out=[];for(const k of ['settings',...COLLECTIONS,'rate_decisions']){if(Array.isArray(before[k])){const ids=new Set([...before[k],...after[k]].map(x=>x.id));for(const key of ids){const a=before[k].find(x=>x.id===key)||null,b=after[k].find(x=>x.id===key)||null;if(JSON.stringify(a)!==JSON.stringify(b))out.push({path:k,id:key,before:a,after:b});}}else if(JSON.stringify(before[k])!==JSON.stringify(after[k]))out.push({path:k,before:before[k],after:after[k]});}return clone(out);}
function apply(r,envelope){validateRecord(r);need(envelope&&text(envelope.type),'Operation type is required.');const actor=text(envelope.actor);need(actor,'Record the responsible operator.');const at=instant(envelope.at||new Date().toISOString(),'Recorded time'),input=clone(envelope.input||{}),opid=text(envelope.id||envelope.operation_id);
 if(opid){const previous=r.history.find(h=>h.operation_id===opid);if(previous){need(previous.request_sha256===hash({type:envelope.type,input,actor}),'Operation ID has different input.');return clone(r);}}
 const next=clone(r);execute(next,envelope.type,input,actor,at);const delta=changes(r,next);next.revision++;next.history.push({revision:next.revision,operation_id:opid,type:envelope.type,actor,at,request_sha256:hash({type:envelope.type,input,actor}),changes:delta});validateRecord(next);return next;
}

function summary(r){validateRecord(r);return {students:r.students.length,aircraft:r.aircraft.length,instructors:r.instructors.length,bookings:r.bookings.length,dispatched:r.bookings.filter(b=>b.status==='Dispatched').length,unposted:r.bookings.filter(b=>['Observed','Reviewed'].includes(b.status)).length,charges:r.ledger.filter(l=>l.kind==='charge'&&!l.reversed).length,deposits:r.deposits.filter(d=>!d.voided).length,sourceRates:rates(r).length,sourceProgrammes:r.source.programmes.length,revision:r.revision};}
function csv(rows,columns){const q=x=>{let s=x===null||x===undefined?'':typeof x==='object'?JSON.stringify(x):String(x);if(/^[=+@]/.test(s)||/^-\D/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};return columns.map(q).join(',')+'\r\n'+rows.map(r=>columns.map(c=>q(r[c])).join(',')).join('\r\n')+(rows.length?'\r\n':'');}
function exportFiles(r){validateRecord(r);const out=[],json=(name,value)=>out.push({name,content:JSON.stringify(value,null,2)+'\n',media_type:'application/json'}),table=(name,rows,columns)=>out.push({name,content:csv(rows,columns),media_type:'text/csv'});json('Working_Record.json',r);json('Original_Source.json',r.source);json('School_Settings.json',r.settings);json('Retained_History.json',r.history);json('Published_Budgets.json',{budgets:r.source.budgets,professional_programme:r.source.professional_programme});json('Published_Programmes.json',r.source.programmes);json('Source_Issues.json',r.source.source_issues);json('Reviewed_Mappings.json',r.mappings);json('Original_Imports.json',r.imports);
 table('Rate_Catalogue.csv',rates(r),['id','label','role','unit','amount_minor','enabled','source_url','notes','decision']);
 table('Students.csv',r.students,['id','name','email','phone','programme_id','status','note']);
 table('Aircraft.csv',r.aircraft,['id','registration','type_id','ownership','status','hobbs','tach','note','reviewed_by','reviewed_at']);
 table('Instructors.csv',r.instructors,['id','name','status','pay_rate_minor','pay_basis','note']);
 table('Bookings.csv',r.bookings,['id','student_id','aircraft_id','instructor_id','starts_at','ends_at','kind','status','purpose','note','lines','quote','approval','dispatch','ledger_id']);
 table('Flight_Observations.csv',r.observations,['id','booking_id','landed_at','hobbs_end','tach_end','flight_minutes','instruction_minutes','ground_minutes','pay_minutes','note','actor','at','superseded']);
 table('Flight_Reviews.csv',r.reviews,['id','booking_id','role','decision','observation_sha256','actor','at','note','superseded']);
 table('Student_Ledger.csv',r.ledger,['id','kind','booking_id','student_id','amount_minor','reverses','reversed','actor','at','note','calculation']);
 table('Instructor_Compensation.csv',r.pay_entries,['id','ledger_id','booking_id','instructor_id','amount_minor','basis','reverses','reversed','actor','at','note']);
 table('Deposit_Receipts.csv',r.deposits,['id','student_id','amount_minor','promo_minor','received_on','reference','payment_method','match','tier','expires_on','promo_eligibility','rounding','voided','note','actor','at']);
 const lots=r.students.flatMap(s=>lotRows(r,s.id));table('Cash_And_Promotional_Lots.csv',lots,['id','deposit_id','student_id','kind','amount_minor','used_minor','refunded_minor','available_minor','expires_on','voided','promo_eligibility']);
 table('Credit_Allocations.csv',r.allocations,['id','student_id','lot_id','kind','ledger_id','amount_minor','on','note','actor','at','reversed','reversal']);
 table('Actual_Refunds.csv',r.refunds,['id','lot_id','student_id','amount_minor','on','reference','note','actor','at','reversed','reversal']);
 table('Progress_Observations.csv',r.progress,['id','student_id','programme_id','phase_id','item','status','on','minutes','evidence','reviewer','note','actor','at']);
 table('Qualification_Observations.csv',r.qualifications,['id','subject_type','subject_id','kind','status','observed_on','expires_on','reference','note','actor','at']);
 table('Maintenance_Observations.csv',r.maintenance,['id','aircraft_id','kind','status','on','resolved_on','reference','note','actor','at']);
 table('Source_Index.csv',r.source.sources,['id','title','url','observed_at','effective_date']);
 table('Deposit_Tier_Observations.csv',r.source.deposit_match_tiers,['id','lower_minor','upper_minor','percent','credit_kind','rounding','expiry','refundability','combination_rule','source_id']);
 table('Published_Policies.csv',r.source.policies,['id','source_id','text']);
 table('Import_Row_Decisions.csv',r.imports.flatMap(i=>i.decisions.map(d=>({import_id:i.id,filename:i.filename,entity:i.entity,...d}))),['import_id','filename','entity','row','id','action']);
 return out;
}
return {create,validateRecord,apply,catalogue,quote,readiness,flightEstimate,account,depositPreview,programmeProgress,previewImport,transferFields,summary,exportFiles,money,parseMoney};
});
