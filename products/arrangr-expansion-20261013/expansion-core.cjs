/* Arrangr expansion workspace. No network or external-send functions. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ArrangrExpansion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCHEMA='tjlabs.arrangr-expansion/v1';
  const TABLES=['users','events','organizations','subscriptions','payments','touches','suppressions'];
  const ACTIVITY=new Set(['meeting_created','meeting_completed','booking_received','poll_created','meeting_confirmed','booking_confirmed']);
  const CONFIRMED=new Set(['meeting_confirmed','meeting_completed','booking_confirmed']);
  const PERSONAL=new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','mail.com','gmx.com','gmx.de','web.de','yandex.com','yandex.ru','mail.ru','qq.com','163.com','126.com','fastmail.com','hey.com']);
  const DAY=86400000;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function fail(message){throw Error(message);}
  function need(value,message){if(!value) fail(message);}
  function stable(value){
    if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  function string(value,label,required=false){
    need(typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),label+' must be text');
    need(!required||value.trim().length>0,label+' is required');
    return value.trim();
  }
  function timestamp(value,label){
    need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp with an explicit timezone');
    const parts=value.slice(0,10).split('-').map(Number);need(parts[1]>=1&&parts[1]<=12&&parts[2]>=1&&parts[2]<=new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate(),label+' contains an invalid calendar date');
    return Date.parse(value);
  }
  function integer(value,label,min=0){
    const n=typeof value==='string'&&value.trim()!==''?Number(value):value;
    need(Number.isSafeInteger(n)&&n>=min,label+' must be an integer');
    return n;
  }
  function bool(value,label){
    if(value===true||value==='true'||value==='1') return true;
    if(value===false||value==='false'||value==='0'||value==='') return false;
    fail(label+' must be true or false');
  }
  function id(value,label='ID'){
    const v=string(value,label,true);
    need(v.length<=240,label+' is too long');
    return v;
  }
  function domain(email){
    const v=String(email).trim().toLowerCase();
    need(/^[^\s@]+@[a-z0-9.-]+\.[a-z0-9-]+$/.test(v),'Invalid email address: '+email);
    return v.slice(v.lastIndexOf('@')+1);
  }
  function currency(value){
    const c=String(value).toUpperCase();
    need(/^[A-Z]{3}$/.test(c),'Use a three-letter currency');
    return c;
  }
  function enums(value,allowed,label){need(allowed.includes(value),'Invalid '+label+': '+value);return value;}
  function row(table,input){
    need(input&&typeof input==='object'&&!Array.isArray(input),'A row must be an object');
    const r=clone(input);
    r.id=id(r.id,table+' row ID');
    const text=(key,fallback='')=>{r[key]=string(r[key]===undefined?fallback:r[key],table+'.'+key);};
    const date=(key,optional=false)=>{if(optional&&!r[key]){r[key]='';return;}timestamp(r[key],table+'.'+key);};
    if(table==='users'){
      text('email');r.email=r.email.toLowerCase();domain(r.email);
      r.email_verified=bool(r.email_verified===undefined?false:r.email_verified,'email_verified');
      text('name');text('organization_id');text('status','active');text('marketing_permission','unknown');text('deleted_at');
      enums(r.status,['active','deleted','suspended'],'user status');
      enums(r.marketing_permission,['allowed','suppressed','unknown'],'marketing permission');
      date('created_at');date('deleted_at',true);
    }
    if(table==='events'){
      text('user_id');text('organization_id');text('pilot_id');text('type');text('source_ref');
      need(r.user_id||r.organization_id,'An event needs an original user or organization ID');
      need(r.type&&r.source_ref,'Event type and source_ref are required');date('at');
    }
    if(table==='organizations'){
      text('name');text('status','active');
      enums(r.status,['active','inactive'],'organization status');
      if(typeof r.domains==='string') r.domains=r.domains.trim().startsWith('[')?JSON.parse(r.domains):r.domains.split(/[;,]/).map(v=>v.trim()).filter(Boolean);
      need(Array.isArray(r.domains),'Organization domains must be a list');
      r.domains=r.domains.map(d=>String(d).toLowerCase().trim());
      need(r.domains.every(d=>/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d)&&!PERSONAL.has(d)),'Organization domains must be exact business domains');
    }
    if(table==='subscriptions'){
      text('subscription_id');text('user_id');text('organization_id');text('source_ref');
      need(r.subscription_id&&r.source_ref&&(r.user_id||r.organization_id),'Subscription needs original identity, source and owner');
      enums(r.status,['active','trialing','cancelled','past_due'],'subscription status');
      r.currency=currency(r.currency);r.monthly_recurring_minor=integer(r.monthly_recurring_minor,'monthly_recurring_minor');
      date('observed_at');
    }
    if(table==='payments'){
      text('subscription_id');text('user_id');text('organization_id');text('source_ref');
      need(r.source_ref&&(r.user_id||r.organization_id),'Payment source and original owner are required');
      enums(r.kind,['payment','refund'],'payment kind');r.currency=currency(r.currency);
      r.net_amount_minor=integer(r.net_amount_minor,'net_amount_minor',-Number.MAX_SAFE_INTEGER);
      need(r.kind==='payment'?r.net_amount_minor>=0:r.net_amount_minor<=0,'Refund amounts must be negative; payment amounts positive');
      date('paid_at');
    }
    if(table==='touches'){
      text('user_id');text('company_key');text('channel');text('outcome');text('source_ref');text('note');
      need(r.user_id&&r.source_ref&&r.channel&&r.outcome,'Contact record needs original user, channel, outcome and source');
      date('at');
    }
    if(table==='suppressions'){
      enums(r.scope,['user','domain','company'],'suppression scope');
      text('key');text('reason');text('source_ref');text('until_at');
      need(r.key&&r.reason&&r.source_ref,'Suppression key, reason and source are required');
      date('at');date('until_at',true);
    }
    return r;
  }
  function settings(value,asOf){
    const s={baseline_at:new Date(timestamp(asOf,'as_of')-28*DAY).toISOString(),active_days:28,reactivation_days:90,cooldown_days:14,min_active_members:2,company_overrides:[],...clone(value||{})};
    timestamp(s.baseline_at,'baseline_at');
    need(Date.parse(s.baseline_at)<=Date.parse(asOf),'Baseline must precede the observation time');
    for(const k of ['active_days','reactivation_days','cooldown_days','min_active_members'])s[k]=integer(s[k],k,1);
    need(s.reactivation_days>=s.active_days,'Reactivation window must exceed the active window');
    need(Array.isArray(s.company_overrides),'Company overrides must be a list');
    const seen=new Set();
    for(const o of s.company_overrides){
      id(o.domain,'override domain');id(o.key,'override company key');
      need(!seen.has(o.domain),'Each exact domain can have only one override');
      need(!PERSONAL.has(o.domain.toLowerCase()),'Personal email domains cannot identify one company');
      seen.add(o.domain);string(o.label||o.domain,'company label');
    }
    return s;
  }
  function create(input={},opts={}){
    const asOf=opts.as_of||input.as_of||new Date().toISOString();
    const w={schema:SCHEMA,workspace_id:opts.workspace_id||input.workspace_id||'expansion-'+Date.now().toString(36),revision:0,as_of:asOf,demonstration:!!opts.demonstration,settings:settings(input.settings,asOf),sources:[],data:{},pilots:[],journal:[]};
    for(const t of TABLES)w.data[t]=(input.data?.[t]||input[t]||[]).map(r=>row(t,r));
    validate(w);
    return w;
  }
  function validate(w){
    need(w&&w.schema===SCHEMA,'Choose a complete Arrangr expansion workspace');
    id(w.workspace_id,'workspace ID');integer(w.revision,'workspace revision');timestamp(w.as_of,'as_of');need(Number.isSafeInteger(w.revision),'Workspace revision must be a number');need(typeof w.demonstration==='boolean','Demonstration flag must be boolean');need(stable(settings(w.settings,w.as_of))===stable(w.settings),'Workspace settings must use canonical field types');
    need(Array.isArray(w.sources)&&Array.isArray(w.pilots)&&Array.isArray(w.journal),'The full source, pilot and operation records are required');
    const indexes={};
    for(const t of TABLES){
      need(Array.isArray(w.data?.[t]),'Missing complete '+t+' table');indexes[t]=new Map();
      for(const r of w.data[t]){need(stable(row(t,r))===stable(r),'Noncanonical '+t+' row '+r.id+'; use table import for normalization');need(!indexes[t].has(r.id),'Duplicate '+t+' ID '+r.id);indexes[t].set(r.id,r);}
    }
    for(const t of ['events','subscriptions','payments','touches']){
      for(const r of w.data[t]){
        if(r.user_id)need(indexes.users.has(r.user_id),t+' references an unknown user: '+r.user_id);
        if(r.organization_id)need(indexes.organizations.has(r.organization_id),t+' references an unknown organization: '+r.organization_id);
      }
    }
    for(const u of w.data.users)if(u.organization_id)need(indexes.organizations.has(u.organization_id),'User references unknown organization '+u.organization_id);
    const snapshotTimes=new Map();
    for(const r of w.data.subscriptions){
      const key=r.subscription_id+'@'+Date.parse(r.observed_at),old=snapshotTimes.get(key);
      const state=x=>stable({user_id:x.user_id,organization_id:x.organization_id,status:x.status,currency:x.currency,monthly_recurring_minor:x.monthly_recurring_minor});
      need(!old||state(old)===state(r),'Conflicting subscription snapshots at the same observation time: '+r.subscription_id);snapshotTimes.set(key,r);
    }
    const pilotIds=new Set(),operations=new Set();
    for(const p of w.pilots){
      id(p.id,'pilot ID');need(!pilotIds.has(p.id),'Duplicate pilot ID');pilotIds.add(p.id);
      id(p.company_key,'pilot company');string(p.owner,'pilot owner',true);timestamp(p.cohort_at,'pilot cohort time');
      need(Array.isArray(p.member_ids)&&p.baseline&&Array.isArray(p.baseline.mrr),'Pilot original cohort and baseline are required');
      need(p.member_ids.every(x=>indexes.users.has(x)),'Pilot cohort lost an original user');
      enums(p.state,['prepared','paused','closed'],'pilot state');
    }
    for(const op of w.journal){id(op.id,'operation ID');need(!operations.has(op.id),'Duplicate operation ID');operations.add(op.id);}
    return w;
  }
  function indexWorkspace(w){
    const orgs=new Map(w.data.organizations.map(o=>[o.id,o])),users=new Map(w.data.users.map(u=>[u.id,u]));
    const byDomain=new Map(),ambiguous=new Set();
    for(const o of orgs.values())for(const d of o.domains){if(byDomain.has(d)&&byDomain.get(d)!==o.id)ambiguous.add(d);else byDomain.set(d,o.id);}
    const overrides=new Map(w.settings.company_overrides.map(o=>[o.domain.toLowerCase(),o]));
    const companyOf=new Map(),companies=new Map(),issues=[];
    function company(key,label,provisional=false){if(!companies.has(key))companies.set(key,{key,label,provisional,member_ids:[],organization_ids:[],domains:[]});return companies.get(key);}
    for(const o of orgs.values())company('org:'+o.id,o.name||o.id).organization_ids.push(o.id);
    for(const u of users.values()){
      const d=domain(u.email),over=overrides.get(d),org=u.organization_id||(ambiguous.has(d)?'':byDomain.get(d));
      let key,label,provisional=false;
      if(u.organization_id||org){key='org:'+org;label=orgs.get(org).name||org;}
      else if(over){key=over.key;label=over.label||d;}
      else if(PERSONAL.has(d)){key='user:'+u.id;label=u.name||u.email;}
      else{key='domain:'+d;label=d;provisional=true;}
      const c=company(key,label,provisional);c.member_ids.push(u.id);if(!c.domains.includes(d))c.domains.push(d);companyOf.set(u.id,key);
      if(ambiguous.has(d)&&!u.organization_id)issues.push({severity:'review',table:'users',id:u.id,reason:'domain_maps_to_multiple_organizations',detail:d});
    }
    const touchesByUser=new Map(),suppressionIndex=new Map(),issueCompanies=new Set();
    for(const t of w.data.touches){if(!touchesByUser.has(t.user_id))touchesByUser.set(t.user_id,[]);touchesByUser.get(t.user_id).push(t);}
    for(const s of w.data.suppressions){const k=s.scope+':'+(s.scope==='domain'?s.key.toLowerCase():s.key);if(!suppressionIndex.has(k))suppressionIndex.set(k,[]);suppressionIndex.get(k).push(s);}
    for(const issue of issues)issueCompanies.add(companyOf.get(issue.id));
    return{orgs,users,companies,companyOf,issues,touchesByUser,suppressionIndex,issueCompanies};
  }
  function addMoney(map,c,amount){const total=(map.get(c)||0)+amount;need(Number.isSafeInteger(total),'Money total exceeds exact integer range for '+c);map.set(c,total);}
  function money(map){return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([currency,minor])=>({currency,minor}));}
  function monetaryOwner(r,index){return r.organization_id?'org:'+r.organization_id:index.companyOf.get(r.user_id);}
  function snapshotsAt(w,when){
    const latest=new Map();
    for(const s of w.data.subscriptions){
      if(Date.parse(s.observed_at)>when)continue;
      const old=latest.get(s.subscription_id);
      if(!old||Date.parse(s.observed_at)>Date.parse(old.observed_at)||(s.observed_at===old.observed_at&&s.id.localeCompare(old.id)>0))latest.set(s.subscription_id,s);
    }
    return [...latest.values()];
  }
  function recurringAt(w,index,when){
    const byCompany=new Map();
    for(const s of snapshotsAt(w,when)){
      if(s.status!=='active')continue;
      const key=monetaryOwner(s,index);if(!byCompany.has(key))byCompany.set(key,new Map());
      addMoney(byCompany.get(key),s.currency,s.monthly_recurring_minor);
    }
    return byCompany;
  }
  function suppressionsFor(w,index,u,key,now){
    const reasons=[];
    if(u.deleted_at)reasons.push('deleted_at_present');
    if(u.status!=='active')reasons.push('account_'+u.status);
    if(!u.email_verified)reasons.push('email_unverified');
    if(u.marketing_permission!=='allowed')reasons.push('permission_'+u.marketing_permission);
    const d=domain(u.email);
    for(const s of ['user:'+u.id,'domain:'+d,'company:'+key].flatMap(k=>index.suppressionIndex.get(k)||[])){
      if(Date.parse(s.at)>now||(s.until_at&&Date.parse(s.until_at)<=now))continue;
      if((s.scope==='user'&&s.key===u.id)||(s.scope==='domain'&&s.key.toLowerCase()===d)||(s.scope==='company'&&s.key===key))reasons.push('suppressed:'+s.reason);
    }
    const prior=(index.touchesByUser.get(u.id)||[]).filter(t=>Date.parse(t.at)<=now);
    if(prior.some(t=>['positive_reply','meeting_requested','human_review'].includes(t.outcome)))reasons.push('reply_requires_owner');
    if(prior.some(t=>['unsubscribed','do_not_contact','hard_bounce'].includes(t.outcome)))reasons.push('contact_'+prior.find(t=>['unsubscribed','do_not_contact','hard_bounce'].includes(t.outcome)).outcome);
    if(prior.some(t=>Date.parse(t.at)>now-w.settings.cooldown_days*DAY))reasons.push('contact_cooldown');
    return [...new Set(reasons)];
  }
  function analyze(w){
    validate(w);
    const now=Date.parse(w.as_of),activeSince=now-w.settings.active_days*DAY,index=indexWorkspace(w);
    const userActivity=new Map(),eventsByCompany=new Map();
    for(const e of w.data.events){
      const when=Date.parse(e.at);if(when>now)continue;
      const key=e.organization_id?'org:'+e.organization_id:index.companyOf.get(e.user_id);
      if(!eventsByCompany.has(key))eventsByCompany.set(key,[]);eventsByCompany.get(key).push(e);
      if(!ACTIVITY.has(e.type)||!e.user_id)continue;
      if(!userActivity.has(e.user_id))userActivity.set(e.user_id,{last:-Infinity,total:0,recent:0,days:new Set()});
      const a=userActivity.get(e.user_id);a.last=Math.max(a.last,when);a.total++;
      if(when>=activeSince){a.recent++;a.days.add(e.at.slice(0,10));}
    }
    const current=recurringAt(w,index,now),baseline=recurringAt(w,index,Date.parse(w.settings.baseline_at));
    const companies=[];
    for(const raw of index.companies.values()){
      const members=raw.member_ids.map(x=>index.users.get(x)),memberDetails=members.map(u=>{
        const a=userActivity.get(u.id)||{last:-Infinity,total:0,recent:0,days:new Set()};
        return{id:u.id,name:u.name,email:u.email,active:u.status==='active'&&a.recent>0,last_activity:Number.isFinite(a.last)?new Date(a.last).toISOString():null,activity_events:a.recent,active_days:a.days.size,suppression_reasons:suppressionsFor(w,index,u,raw.key,now)};
      });
      const active=memberDetails.filter(u=>u.active),eligible=memberDetails.filter(u=>!u.suppression_reasons.length);
      const candidates=eligible.filter(u=>u.active).sort((a,b)=>b.active_days-a.active_days||b.activity_events-a.activity_events||String(b.last_activity).localeCompare(String(a.last_activity))||a.id.localeCompare(b.id));
      const last=members.reduce((n,u)=>Math.max(n,userActivity.get(u.id)?.last??-Infinity),-Infinity);
      const existing=raw.organization_ids.some(id=>index.orgs.get(id).status==='active');
      const ambiguous=index.issueCompanies.has(raw.key);
      let segment='single_active',reasons=[];
      if(ambiguous){segment='review_domain';reasons.push('The email domain belongs to multiple observed organizations.');}
      else if(existing){segment='existing_team';reasons.push('An existing organization is already present in the source.');}
      else if(active.length>=w.settings.min_active_members&&candidates.length){segment='expansion_ready';reasons.push(active.length+' members used qualifying scheduling actions in the active window.');}
      else if(Number.isFinite(last)&&last<now-w.settings.reactivation_days*DAY&&eligible.length){segment='reactivation';reasons.push('Past scheduling activity exists, followed by the configured dormant period.');}
      else if(!eligible.length){segment='suppressed';reasons.push('No member is currently eligible for the contact workflow.');}
      else reasons.push('The current source does not yet meet the multi-member activity threshold.');
      if(raw.provisional)reasons.push('Candidate association uses the exact email domain; no organization membership is inferred.');
      const champion=candidates[0]||(segment==='reactivation'?eligible.sort((a,b)=>String(b.last_activity).localeCompare(String(a.last_activity))||a.id.localeCompare(b.id))[0]:null);
      companies.push({...raw,registered_members:members.length,active_members:active.length,eligible_members:eligible.length,activity_events:active.reduce((n,u)=>n+u.activity_events,0),champion:champion||null,segment,reasons,members:memberDetails,current_mrr:money(current.get(raw.key)||new Map()),baseline_mrr:money(baseline.get(raw.key)||new Map()),last_activity:Number.isFinite(last)?new Date(last).toISOString():null,next_action:segment==='expansion_ready'?'Prepare one company pilot':segment==='reactivation'?'Prepare a value-based reactivation':segment==='existing_team'?'Review current team usage':segment==='review_domain'?'Resolve the original organization association':'Review activity and eligibility'});
    }
    companies.sort((a,b)=>b.active_members-a.active_members||b.activity_events-a.activity_events||a.key.localeCompare(b.key));
    const byCompany=new Map(companies.map(c=>[c.key,c])),latestSubscriptions=snapshotsAt(w,now);
    const pilotResults=w.pilots.map(p=>{
      const start=Date.parse(p.cohort_at),members=new Set(p.member_ids);
      const windowEvents=w.data.events.filter(e=>Date.parse(e.at)>=start&&Date.parse(e.at)<=now&&(!e.pilot_id||e.pilot_id===p.id));
      const createdEvents=windowEvents.filter(e=>e.type==='team_created'&&e.pilot_id===p.id&&e.organization_id);
      const createdOrgs=new Set(createdEvents.map(e=>e.organization_id)),createdAtByOrg=new Map();
      for(const e of createdEvents)createdAtByOrg.set(e.organization_id,Math.min(createdAtByOrg.get(e.organization_id)??Infinity,Date.parse(e.at)));
      const associatedOrgs=new Set([...createdOrgs,...(p.organization_ids||[])]);
      const unrelatedMemberships=p.member_ids.map(id=>({user_id:id,organization_id:index.users.get(id)?.organization_id||''})).filter(x=>x.organization_id&&!associatedOrgs.has(x.organization_id));
      if(p.company_key.startsWith('org:'))associatedOrgs.add(p.company_key.slice(4));
      const events=windowEvents.filter(e=>e.pilot_id===p.id||members.has(e.user_id)||associatedOrgs.has(e.organization_id));
      const exposed=new Set(events.filter(e=>e.type==='offer_exposed'&&e.pilot_id===p.id&&members.has(e.user_id)).map(e=>e.user_id));
      const acceptedEvents=events.filter(e=>e.type==='team_invite_accepted'&&e.pilot_id===p.id&&members.has(e.user_id)&&createdOrgs.has(e.organization_id)&&Date.parse(e.at)>=createdAtByOrg.get(e.organization_id));
      const accepted=new Set(acceptedEvents.map(e=>e.user_id));
      const active=new Set(events.filter(e=>ACTIVITY.has(e.type)&&members.has(e.user_id)).map(e=>e.user_id));
      const confirmed=new Set(events.filter(e=>CONFIRMED.has(e.type)&&members.has(e.user_id)).map(e=>e.user_id));
      const activatedByOrg=new Map();
      for(const org of createdOrgs){
        const earliest=new Map();
        for(const e of acceptedEvents.filter(e=>e.organization_id===org)){
          const t=Date.parse(e.at);earliest.set(e.user_id,Math.min(earliest.get(e.user_id)??Infinity,t));
        }
        const activeAccepted=new Set(events.filter(e=>e.organization_id===org&&CONFIRMED.has(e.type)&&earliest.has(e.user_id)&&Date.parse(e.at)>=earliest.get(e.user_id)).map(e=>e.user_id));
        activatedByOrg.set(org,activeAccepted);
      }
      const activatedMembers=new Set([...activatedByOrg.values()].flatMap(v=>[...v]));
      const ownerMatches=r=>r.organization_id?associatedOrgs.has(r.organization_id):members.has(r.user_id);
      const payments=w.data.payments.filter(r=>ownerMatches(r)&&Date.parse(r.paid_at)>=start&&Date.parse(r.paid_at)<=now);
      const cash=new Map();for(const r of payments)addMoney(cash,r.currency,r.net_amount_minor);
      const currentMrr=new Map();
      for(const r of latestSubscriptions)if(r.status==='active'&&ownerMatches(r))addMoney(currentMrr,r.currency,r.monthly_recurring_minor);
      const delta=new Map(currentMrr);for(const m of p.baseline.mrr)addMoney(delta,m.currency,-m.minor);
      return{pilot_id:p.id,company_key:p.company_key,label:p.label||byCompany.get(p.company_key)?.label||p.company_key,state:p.state,owner:p.owner,cohort_at:p.cohort_at,cohort_members:p.member_ids.length,exposed_members:exposed.size,accepted_members:accepted.size,active_members:active.size,confirmed_members:confirmed.size,activated_members:activatedMembers.size,organization_ids:[...associatedOrgs].sort(),association_review:unrelatedMemberships,team_created:createdOrgs.size>0,team_activated:[...activatedByOrg.values()].some(v=>v.size>=2),current_mrr:money(currentMrr),baseline_mrr:clone(p.baseline.mrr),net_mrr_change:money(delta),net_paid:money(cash),paid_record_ids:payments.map(r=>r.id),event_ids:events.map(e=>e.id),interpretation:'Observed cohort and associated organization outcomes; before/after change is not a causal lift estimate. Organization billing can include seats outside the original cohort.'};
    });
    const mrr=new Map(),cash=new Map(),counts={};
    for(const c of companies){counts[c.segment]=(counts[c.segment]||0)+1;for(const m of c.current_mrr)addMoney(mrr,m.currency,m.minor);}
    for(const p of w.data.payments)if(Date.parse(p.paid_at)<=now)addMoney(cash,p.currency,p.net_amount_minor);
    return{schema:'tjlabs.arrangr-analysis/v1',as_of:w.as_of,companies,pilot_results:pilotResults,data_issues:index.issues,summary:{users:w.data.users.length,companies:companies.length,events:w.data.events.length,pilots:w.pilots.length,segments:counts,current_mrr:money(mrr),net_paid:money(cash),billing_coverage:w.data.subscriptions.length?'provided':'missing',payment_coverage:w.data.payments.length?'provided':'missing'}};
  }
  function apply(workspace,action){
    validate(workspace);need(action&&typeof action==='object','Operation is required');id(action.id,'operation ID');
    const prior=workspace.journal.find(x=>x.id===action.id);
    if(prior){need(stable(prior.input)===stable(action),'Operation ID belongs to different input');return clone(workspace);}
    need(action.expected_revision===workspace.revision,'Workspace changed; use its current revision');
    const w=clone(workspace),now=w.as_of;
    function note(){string(action.note,'operation note',true);need(action.note.trim().length>=8,'Record a useful operation note');}
    if(action.type==='prepare_pilot'){
      note();string(action.owner,'pilot owner',true);const c=analyze(w).companies.find(x=>x.key===action.company_key);
      need(c&&['expansion_ready','reactivation'].includes(c.segment),'Choose a currently eligible company or reactivation cohort');
      need(!w.pilots.some(p=>p.company_key===c.key&&p.state!=='closed'),'This company already has an open pilot');
      w.pilots.push({id:'pilot:'+action.id,company_key:c.key,label:c.label,owner:action.owner,state:'prepared',kind:c.segment,cohort_at:now,organization_ids:clone(c.organization_ids),member_ids:clone(c.member_ids),champion_id:c.champion.id,source_revision:w.revision,baseline:{as_of:now,mrr:clone(c.current_mrr),active_members:c.active_members,registered_members:c.registered_members},note:action.note});
    }else if(action.type==='record_touch'){
      note();need(w.data.users.some(u=>u.id===action.user_id),'Contact user is missing');
      w.data.touches.push(row('touches',{id:'touch:'+action.id,user_id:action.user_id,company_key:action.company_key||'',channel:action.channel,outcome:action.outcome,source_ref:action.source_ref,note:action.note,at:action.at||now}));
    }else if(action.type==='suppress'){
      w.data.suppressions.push(row('suppressions',{id:'suppression:'+action.id,scope:action.scope,key:action.key,reason:action.reason,source_ref:action.source_ref,at:action.at||now,until_at:action.until_at||''}));
    }else if(action.type==='set_pilot_state'){
      note();const p=w.pilots.find(p=>p.id===action.pilot_id);need(p,'Pilot is missing');
      enums(action.state,['paused','closed'],'pilot state');need(p.state!=='closed'||action.state==='closed','Closed pilots cannot be reopened; prepare a new cohort');p.state=action.state;p.state_note=action.note;p.state_at=now;
    }else if(action.type==='settings'){
      note();w.settings=settings({...w.settings,...clone(action.patch||{})},w.as_of);
    }else if(action.type==='set_as_of'){
      note();timestamp(action.as_of,'observation time');w.as_of=action.as_of;w.settings=settings(w.settings,w.as_of);
    }else fail('Unknown operation type');
    w.revision++;w.journal.push({id:action.id,at:now,revision:w.revision,input:clone(action)});validate(w);return w;
  }
  function importRows(workspace,table,rows,source){
    validate(workspace);need(TABLES.includes(table),'Unknown source table');need(Array.isArray(rows),'Import a complete row list');
    need(source&&source.id&&source.name,'Retain a source ID and name');id(source.id,'source ID');
    const sourceMeta={};
    for(const k of ['original_filename','original_text','original_headers','original_rows','mapping','original'])if(source[k]!==undefined)sourceMeta[k]=clone(source[k]);
    const prior=workspace.sources.find(s=>s.id===source.id);
    if(prior){need(prior.table===table&&prior.mode===(source.mode||'append')&&stable(prior.rows)===stable(rows)&&Object.keys(sourceMeta).every(k=>stable(prior[k])===stable(sourceMeta[k])),'Source ID belongs to different content');return clone(workspace);}
    const mode=source.mode||'append';enums(mode,['append','upsert'],'import mode');
    const incoming=rows.map(r=>row(table,r)),w=clone(workspace),map=new Map(w.data[table].map(r=>[r.id,r])),changes=[];
    const unique=new Set();
    for(const r of incoming){
      need(!unique.has(r.id),'Repeated row ID inside import '+r.id);unique.add(r.id);
      const old=map.get(r.id);if(old&&stable(old)!==stable(r)){need(mode==='upsert','Changed existing '+table+' row '+r.id+' requires upsert mode');changes.push({id:r.id,before:clone(old),after:clone(r)});}
      else if(!old)changes.push({id:r.id,before:null,after:clone(r)});
      map.set(r.id,r);
    }
    w.data[table]=[...map.values()];w.sources.push({id:source.id,name:source.name,table,mode,imported_at:source.imported_at||w.as_of,...sourceMeta,rows:clone(rows),changes});w.revision++;
    w.journal.push({id:'import:'+source.id,at:w.as_of,revision:w.revision,input:{type:'import',table,source_id:source.id,row_count:rows.length,mode}});
    validate(w);return w;
  }
  function parseCSV(text){
    need(typeof text==='string','CSV input must be text');text=text.replace(/^\uFEFF/,'');
    const rows=[];let row=[],cell='',quoted=false,afterQuote=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;afterQuote=true;}else cell+=c;continue;}
      if(afterQuote)need(c===','||c==='\n'||c==='\r','Unexpected character after closing CSV quote');
      if(c==='"'){need(cell.length===0,'Unexpected quote in CSV field');quoted=true;}
      else if(c===','){row.push(cell);cell='';afterQuote=false;}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';afterQuote=false;}
      else cell+=c;
    }
    need(!quoted,'CSV ends inside a quoted field');
    if(cell.length||row.length||afterQuote){row.push(cell);rows.push(row);}
    need(rows.length,'CSV is empty');const headers=rows.shift().map(h=>h.trim());
    need(headers.every(Boolean)&&new Set(headers).size===headers.length,'CSV headers must be nonempty and unique');
    return{headers,rows:rows.filter(r=>r.some(v=>v!=='')).map((r,i)=>{need(r.length===headers.length,'CSV row '+(i+2)+' has a different column count');return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));})};
  }
  function toCSV(rows){
    need(Array.isArray(rows),'Rows must be a list');if(!rows.length)return '';
    const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const cell=v=>{let s=v===undefined||v===null?'':typeof v==='object'?JSON.stringify(v):String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    return headers.map(cell).join(',')+'\r\n'+rows.map(r=>headers.map(h=>cell(r[h])).join(',')).join('\r\n')+'\r\n';
  }

  function demo(){
    const as_of='2026-10-13T12:00:00.000Z';
    const users=[
      ['green-1','maya@greenlane.test','Maya',''],['green-2','noah@greenlane.test','Noah',''],
      ['pixel-1','amina@pixelnode.test','Amina',''],['pixel-2','luca@pixelnode.test','Luca',''],['pixel-3','elin@pixelnode.test','Elin',''],
      ['dormant-1','ava@quietworks.test','Ava',''],['existing-1','sam@atlasworks.test','Sam','atlas'],['existing-2','rory@atlasworks.test','Rory','atlas'],
      ['personal-1','example.one@gmail.com','Personal one',''],['personal-2','example.two@gmail.com','Personal two',''],
      ['blocked-1','lin@blocked.test','Lin',''],['blocked-2','lee@blocked.test','Lee','']
    ].map(([id,email,name,organization_id])=>({id,email,name,organization_id,email_verified:true,status:'active',marketing_permission:id==='pixel-3'?'unknown':'allowed',created_at:'2026-06-01T09:00:00.000Z'}));
    const events=[];let n=0;
    for(const u of users){
      if(u.id==='dormant-1'){events.push({id:'demo-event-'+(++n),user_id:u.id,type:'meeting_completed',at:'2026-06-15T10:00:00.000Z',source_ref:'demonstration:product-log'});continue;}
      for(const date of ['2026-10-01','2026-10-08'])events.push({id:'demo-event-'+(++n),user_id:u.id,organization_id:u.organization_id,type:'meeting_created',at:date+'T10:00:00.000Z',source_ref:'demonstration:product-log'});
    }
    return create({settings:{baseline_at:'2026-09-15T12:00:00.000Z'},data:{
      users,events,organizations:[{id:'atlas',name:'Atlas Works — demonstration',domains:['atlasworks.test'],status:'active'}],
      subscriptions:[
        {id:'baseline-green',subscription_id:'green-personal',user_id:'green-1',status:'active',currency:'USD',monthly_recurring_minor:600,observed_at:'2026-09-10T00:00:00.000Z',source_ref:'demonstration:billing-snapshot'},
        {id:'baseline-pixel',subscription_id:'pixel-personal',user_id:'pixel-1',status:'active',currency:'EUR',monthly_recurring_minor:400,observed_at:'2026-09-10T00:00:00.000Z',source_ref:'demonstration:billing-snapshot'},
        {id:'baseline-atlas',subscription_id:'atlas-team',organization_id:'atlas',status:'active',currency:'USD',monthly_recurring_minor:1600,observed_at:'2026-09-10T00:00:00.000Z',source_ref:'demonstration:billing-snapshot'}
      ],payments:[],touches:[],
      suppressions:[{id:'blocked-domain',scope:'domain',key:'blocked.test',reason:'Recorded do-not-contact preference',at:'2026-10-01T00:00:00.000Z',source_ref:'demonstration:preference-record'}]
    }},{as_of,workspace_id:'arrangr-demonstration',demonstration:true});
  }
  function demoJourney(){
    const initial=demo(),first=analyze(initial);
    let w=apply(initial,{id:'green-company-pilot',expected_revision:initial.revision,type:'prepare_pilot',company_key:'domain:greenlane.test',owner:'Demonstration operator',note:'Observe a frozen two-member expansion cohort.'});
    const pilotId=w.pilots[0].id;
    w=apply(w,{id:'observation-oct20',expected_revision:w.revision,type:'set_as_of',as_of:'2026-10-20T12:00:00.000Z',note:'Load the later source edition for the same pilot.'});
    const org={id:'green-team',name:'Green Lane — demonstration',domains:['greenlane.test'],status:'active'};
    w=importRows(w,'organizations',[org],{id:'demo-org-edition-2',name:'Observed team organization',mode:'append'});
    const users=w.data.users.filter(u=>u.id.startsWith('green-')).map(u=>({...u,organization_id:'green-team'}));
    w=importRows(w,'users',users,{id:'demo-users-edition-2',name:'Observed original-user team membership',mode:'upsert'});
    const event=(id,type,user_id,at,organization_id='green-team')=>({id,type,user_id,at,organization_id,pilot_id:pilotId,source_ref:'demonstration:pilot-product-events'});
    const events=[
      event('green-exposure-1','offer_exposed','green-1','2026-10-13T13:00:00.000Z',''),
      event('green-exposure-2','offer_exposed','green-2','2026-10-13T13:05:00.000Z',''),
      event('green-team-created','team_created','green-1','2026-10-14T09:00:00.000Z'),
      event('green-invite-1','team_invite_accepted','green-1','2026-10-14T09:05:00.000Z'),
      event('green-invite-2','team_invite_accepted','green-2','2026-10-14T09:15:00.000Z'),
      event('green-confirmed-1','meeting_confirmed','green-1','2026-10-15T10:00:00.000Z'),
      event('green-confirmed-2','booking_confirmed','green-2','2026-10-16T10:00:00.000Z')
    ];
    w=importRows(w,'events',events,{id:'demo-events-edition-2',name:'Observed invitation and confirmed Arrangr activity',mode:'append'});
    w=importRows(w,'subscriptions',[
      {id:'green-personal-cancelled',subscription_id:'green-personal',user_id:'green-1',status:'cancelled',currency:'USD',monthly_recurring_minor:0,observed_at:'2026-10-14T09:30:00.000Z',source_ref:'demonstration:billing-snapshot'},
      {id:'green-team-active',subscription_id:'green-team-subscription',organization_id:'green-team',status:'active',currency:'USD',monthly_recurring_minor:1800,observed_at:'2026-10-15T09:00:00.000Z',source_ref:'demonstration:billing-snapshot'}
    ],{id:'demo-subscriptions-edition-2',name:'Observed account-to-team billing changes',mode:'append'});
    w=importRows(w,'payments',[
      {id:'green-payment',subscription_id:'green-team-subscription',organization_id:'green-team',currency:'USD',net_amount_minor:1800,kind:'payment',paid_at:'2026-10-15T09:00:00.000Z',source_ref:'demonstration:invoice-paid'},
      {id:'green-refund',subscription_id:'green-team-subscription',organization_id:'green-team',currency:'USD',net_amount_minor:-200,kind:'refund',paid_at:'2026-10-18T09:00:00.000Z',source_ref:'demonstration:refund'}
    ],{id:'demo-payments-edition-2',name:'Observed receipt and partial refund',mode:'append'});
    const result=analyze(w),reopened=clone(w);validate(reopened);
    need(stable(analyze(reopened))===stable(result),'Reopened analysis differs');
    return{initial,initial_analysis:first,workspace:w,analysis:result,reopened};
  }

  return{SCHEMA,TABLES,demo,demoJourney,ACTIVITY:[...ACTIVITY],create,validate,analyze,apply,importRows,parseCSV,toCSV,stable};
});
