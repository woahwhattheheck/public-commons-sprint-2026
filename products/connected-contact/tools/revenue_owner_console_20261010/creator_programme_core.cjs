'use strict';
/** Creator programmes in the original sales workspace. No provider calls or payments. */
/** Complete immutable commercial values stay inside their original programme. */
const VERSION='dealscout.creator-commercial-payloads.v1';
const EXTENSION='dealscout.creator-commercial-receiving.v2';
function createCreatorCommercialPayloads({hashText}) {
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const need=(v,message)=>{if(!v)throw Object.assign(Error(message),{status:422,code:'CREATOR_COMMERCIAL_PAYLOAD'});};
  const bytes=text=>{let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n;};
  const identity=(kind,value)=>{const text=JSON.stringify({kind,value});return {sha256:hashText(text),bytes:bytes(text)};};
  function readPool(p) {
    const pool=p.commercial_payloads??{version:VERSION,entries:[]};
    need(plain(pool)&&pool.version===VERSION&&Array.isArray(pool.entries),'Retain the complete original commercial payload collection.');
    const map=new Map();
    for(const entry of pool.entries){
      need(plain(entry)&&['field','schedule','request'].includes(entry.kind)&&Object.hasOwn(entry,'value'),'Retain each complete commercial payload.');
      const id=identity(entry.kind,entry.value);
      need(entry.sha256===id.sha256&&entry.bytes===id.bytes&&!map.has(entry.sha256),'The original commercial payload bytes, hash or identity differ.');
      map.set(entry.sha256,entry);
    }
    return {pool,map};
  }
  function resolver(p){
    const {map}=readPool(p);
    return ref=>{
      need(plain(ref)&&Object.keys(ref).sort().join(',')==='bytes,kind,sha256','Retain the exact commercial payload reference.');
      const entry=map.get(ref.sha256);
      need(entry&&entry.kind===ref.kind&&entry.bytes===ref.bytes,'Receive the referenced original commercial payload in this same programme.');
      return entry.value;
    };
  }
  function readSchedule(ref,resolve){
    need(ref?.kind==='schedule','Retain the original schedule payload kind.');
    const packed=resolve(ref);
    need(plain(packed)&&plain(packed.value)&&plain(packed.fields),'Retain the complete original schedule body.');
    const value=clone(packed.value);
    for(const [key,field] of Object.entries(packed.fields)){
      need(['commercial_source','original_workshare_edition','scope_snapshot'].includes(key)&&Object.hasOwn(value,key)&&value[key]===null&&field?.kind==='field','The schedule field reference differs.');
      value[key]=clone(resolve(field));
    }
    return value;
  }
  function readRequest(ref,resolve){
    need(ref?.kind==='request','Retain the original request payload kind.');
    const packed=resolve(ref);
    need(plain(packed)&&plain(packed.body)&&plain(packed.body.input),'Retain the complete original request body.');
    const body=clone(packed.body);
    if(packed.schedule){
      need(body.kind==='schedule-save'&&Object.hasOwn(body.input,'schedule')&&body.input.schedule===null,'The original request schedule binding differs.');
      body.input.schedule=readSchedule(packed.schedule,resolve);
    }
    return body;
  }
  function extension(p,document=p.document,read=null){
    const x=document?.extensions?.creator_commercial_receiving;
    if(!x)return {version:'dealscout.creator-commercial-receiving.v1',schedules:[],operations:[]};
    if(x.version!==EXTENSION)return clone(x);
    need(Array.isArray(x.schedules)&&Array.isArray(x.operations),'Retain the complete commercial extension.');
    const resolve=read||resolver(p);
    return {...clone(x),version:'dealscout.creator-commercial-receiving.v1',
      schedules:x.schedules.map(row=>{need(row.document===null&&row.document_ref,'Retain one original schedule reference.');const value=clone(row);delete value.document_ref;value.document=readSchedule(row.document_ref,resolve);return value;}),
      operations:x.operations.map(row=>{need(row.request===null&&row.request_ref,'Retain one original request reference.');const value=clone(row);delete value.request_ref;value.request=readRequest(row.request_ref,resolve);return value;})};
  }
  function pack(p,x){
    const {pool:existing}=readPool(p),pool=clone(existing),map=new Map(pool.entries.map(v=>[v.sha256,v]));
    function put(kind,value){
      const id=identity(kind,value),ref={kind,...id};
      if(!map.has(id.sha256)){const entry={...ref,value:clone(value)};pool.entries.push(entry);map.set(id.sha256,entry);}
      return ref;
    }
    function schedule(value){
      const packed={value:clone(value),fields:{}};
      for(const key of ['commercial_source','original_workshare_edition','scope_snapshot'])if(Object.hasOwn(packed.value,key)){
        packed.fields[key]=put('field',packed.value[key]);packed.value[key]=null;
      }
      return put('schedule',packed);
    }
    function request(body){
      const packed={body:clone(body)};
      if(body.kind==='schedule-save'&&plain(body.input?.schedule)){packed.schedule=schedule(body.input.schedule);packed.body.input.schedule=null;}
      return put('request',packed);
    }
    const output={...clone(x),version:EXTENSION,
      schedules:x.schedules.map(row=>{const value=clone(row);value.document=null;return {...value,document_ref:schedule(row.document)};}),
      operations:x.operations.map(row=>{const value=clone(row);value.request=null;return {...value,request_ref:request(row.request)};})};
    return {extension:output,payloads:pool};
  }
  function validate(p){
    const resolve=resolver(p),schedules=new Map(),requests=new Map();
    for(const v of [...(p.history||[]),p]){
      const x=v.document?.extensions?.creator_commercial_receiving;
      if(x?.version!==EXTENSION)continue;
      need(Array.isArray(x.schedules)&&Array.isArray(x.operations),'Retain complete commercial schedules and requests.');
      for(const row of x.schedules){
        need(row.document===null&&row.document_ref,'Retain one exact schedule reference.');
        resolve(row.document_ref);
        let digest=schedules.get(row.document_ref.sha256);
        if(!digest){digest=hashText(JSON.stringify(readSchedule(row.document_ref,resolve)));schedules.set(row.document_ref.sha256,digest);}
        need(digest===row.sha256,'The retained schedule differs from its original document hash.');
      }
      for(const row of x.operations){
        need(row.request===null&&row.request_ref,'Retain one exact request reference.');
        resolve(row.request_ref);
        let digest=requests.get(row.request_ref.sha256);
        if(!digest){digest=hashText(JSON.stringify(readRequest(row.request_ref,resolve)));requests.set(row.request_ref.sha256,digest);}
        need(digest===row.request_sha256,'The retained request differs from its original request hash.');
      }
    }
    return p;
  }
  function operation(p,id){
    const resolve=resolver(p),requests=new Map(),found=[];
    for(const v of [p,...(p.history||[])]){
      const x=v.document?.extensions?.creator_commercial_receiving;
      for(const raw of (x?.operations||[]).filter(row=>row.id===id)){
        const row=clone(raw);
        if(x.version===EXTENSION){
          need(row.request===null&&row.request_ref,'Retain one original request reference.');
          resolve(row.request_ref);
          if(!requests.has(row.request_ref.sha256))requests.set(row.request_ref.sha256,readRequest(row.request_ref,resolve));
          row.request=requests.get(row.request_ref.sha256);delete row.request_ref;
        }
        need(hashText(JSON.stringify(row.request))===row.request_sha256,'The complete original commercial request differs.');
        found.push(row);
      }
    }
    if(!found.length)return null;
    const first=hashText(JSON.stringify(found[0]));
    need(found.every(row=>hashText(JSON.stringify(row))===first),'The original commercial request has conflicting retained results.');
    return clone(found[0]);
  }
  function extendsPayloads(later,earlier){
    const a=readPool(later).map,b=readPool(earlier).map;
    return [...b].every(([id,v])=>a.has(id)&&a.get(id).kind===v.kind&&a.get(id).bytes===v.bytes);
  }
  return Object.freeze({VERSION,EXTENSION,extension,pack,validate,operation,extendsPayloads});
}

function createCreatorProgrammeEngine({hash, hashText, validateLeadPack}) {
  if(typeof hash!=='function'||typeof hashText!=='function'||typeof validateLeadPack!=='function') throw new Error('Supply the maintained source hashing and lead-record receiver.');
  const VERSION='dealscout.creator-programmes.v1', BUNDLE='dealscout.creator-programme-handover.v1';
  const commercialPayloads=createCreatorCommercialPayloads({hashText});
  const REPORT_REVIEW='dealscout.creator-programme-report-review.v1';
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const fail=(message,status=422,details)=>Object.assign(new Error(message),{status,code:'CREATOR_PROGRAMME',...(details?{details}:{})});
  const need=(v,m,s=422,d)=>{if(!v)throw fail(m,s,d);};
  const exact=(a,b)=>hash(a)===hash(b);
  const text=(v,label,max=4000,required=false)=>{need(typeof v==='string'&&v.length<=max&&(!required||v.trim()),'Supply '+label+'.');return v;};
  const id=(v,label='an original ID')=>{need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v),'Supply '+label+'.');return v;};
  const money=(v,label='a nonnegative minor-unit amount')=>{need(typeof v==='string'&&/^(0|[1-9][0-9]{0,23})$/.test(v),'Supply '+label+' as an exact integer string.');return v;};
  const int=(v,label,min=0,max=1000000)=>{need(Number.isSafeInteger(v)&&v>=min&&v<=max,'Supply '+label+'.');return v;};
  const instant=(v,label)=>{need(typeof v==='string'&&/T.*(Z|[+-][0-9]{2}:[0-9]{2})$/.test(v)&&Number.isFinite(Date.parse(v)),'Supply '+label+' with an explicit timezone.');return v;};
  const date=(v,label)=>{need(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Supply '+label+' as YYYY-MM-DD.');return v;};
  const choice=(v,values,label)=>{need(values.includes(v),'Choose '+label+'.');return v;};
  const url=(v,label)=>{text(v,label,4000,true);const m=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(v);need(m&&!m[2].includes('..')&&(!m[3]||Number(m[3])<=65535),'Use an absolute HTTP or HTTPS '+label+'.');return v;};
  const unique=(rows,label)=>{need(Array.isArray(rows),'Supply '+label+'.');const ids=new Set();for(const r of rows){id(r.id);need(!ids.has(r.id),'Duplicate '+label+' identity: '+r.id);ids.add(r.id);}return rows;};
  const byId=(rows,key,label)=>{const row=rows.find(r=>r.id===key);need(row,'The original '+label+' is unavailable: '+key,404);return row;};
  const empty=()=>({version:VERSION,programmes:[],operations:[]});
  function checkRecord(r,label) {
    id(r.id);int(r.revision,label+' revision',1);need(plain(r.document)&&Array.isArray(r.history),'Keep the complete '+label+' record.');
    const versions=[...r.history,{revision:r.revision,document:r.document,sha256:r.sha256,at:r.at}];
    need(versions.length===r.revision,'Keep every '+label+' revision.');
    versions.forEach((v,i)=>{need(v.revision===i+1&&v.sha256===hash(v.document),'A saved '+label+' revision differs.');instant(v.at,label+' revision time');});
  }
  function validate(ledger) {
    need(plain(ledger),'Open the original workspace.');
    const root=ledger.creator_programmes===undefined?empty():clone(ledger.creator_programmes);
    need(root.version===VERSION,'Use the complete creator-programme workspace.');
    unique(root.programmes,'programmes');unique(root.operations,'operations');
    for(const op of root.operations){need(op.request_sha256===hash({kind:op.kind,input:op.input,expected_root_sha256:op.expected_root_sha256}),'An original operation input changed.');instant(op.at,'operation time');
      if(op.kind==='programme-receive'&&(op.input?.report_review||op.result?.report_review))validateSavedReportReview(op);
    }
    for(const p of root.programmes){
      checkRecord(p,'programme');commercialPayloads.validate(p);
      for(const v of [...p.history,p])configuration(v.document);
      need(plain(p.source)&&p.source.sha256===hash(p.source.bundle),'The original full lead-pack selection differs.');
      validateLeadPack(p.source.bundle);
      need(p.pack_id===p.source.bundle.pack.id,'Keep the original customer pack.');
      for(const name of ['creators','sources','decisions','accruals','payments','costs'])unique(p[name],name);
      unique(p.term_changes||[],'term changes');
      unique(p.payment_returns||[],'creator cash returns');unique(p.settlement_cases||[],'settlement cases');
      for(const change of p.term_changes||[]){const c=byId(p.creators,change.creator_id,'creator');need(c.document.terms.some(t=>t.id===change.term_id&&t.state==='agreed'),'The termination lost its original agreed term.');instant(change.effective_at,'termination effective time');instant(change.recorded_at,'termination recorded time');text(change.reason,'termination reason',8000,true);text(change.evidence,'termination evidence',8000,true);}
      p.creators.forEach(c=>{checkRecord(c,'creator');for(const v of [...c.history,c])creatorDocument(v.document,p);});
      p.sources.forEach(s=>{checkRecord(s,'source');for(const v of [...s.history,s])sourceDocument(v.document,p);});
      p.decisions.forEach(d=>{need(d.sha256===hash(d.document),'The reviewed attribution differs.');id(d.document.user_id);});
      p.accruals.forEach(r=>{money(r.amount_minor);need(r.currency===p.document.currency&&p.creators.some(c=>c.id===r.creator_id),'The recorded earning selection differs.');instant(r.recorded_at,'earning record time');need(plain(r.statement)&&typeof r.report_sha256==='string','Retain the full original compensation statement.');});
      p.payments.forEach(r=>{money(r.amount_minor);need(r.currency===p.document.currency&&p.creators.some(c=>c.id===r.creator_id),'Preserve the original payment currency and creator.');instant(r.paid_at,'payment time');text(r.provider_id,'actual payment reference',1000,true);});
      p.costs.forEach(r=>{money(r.amount_minor);need(r.currency===p.document.currency,'Preserve the original cost currency.');instant(r.occurred_at,'cost time');text(r.evidence,'cost source',4000,true);});
      need(new Set(p.payments.map(r=>r.provider_id)).size===p.payments.length,'An actual payment reference is recorded more than once.');
      const returnReferences=new Set(),returnedByPayment=new Map();
      for(const row of p.payment_returns||[]){
        const payment=byId(p.payments,id(row.payment_id),'completed creator payment');
        need(row.creator_id===payment.creator_id&&row.currency===payment.currency,'Keep the original returned payment creator and currency.');
        money(row.amount_minor);need(BigInt(row.amount_minor)>0n,'Record a positive completed cash return.');
        text(row.provider_id,'actual return reference',1000,true);
        need(!returnReferences.has(row.provider_id)&&!p.payments.some(r=>r.provider_id===row.provider_id),'An actual cash reference is recorded more than once.');returnReferences.add(row.provider_id);
        instant(row.returned_at,'actual cash return time');instant(row.recorded_at,'cash return record time');
        need(Date.parse(row.returned_at)>=Date.parse(payment.paid_at)&&Date.parse(row.returned_at)<=Date.parse(row.recorded_at),'The actual cash return precedes its payment or follows its record.');
        text(row.reason,'cash return reason',8000,true);text(row.evidence,'cash return evidence',8000,true);
        const returned=(returnedByPayment.get(payment.id)||0n)+BigInt(row.amount_minor);
        need(returned<=BigInt(payment.amount_minor),'Completed cash returns exceed the original payment.');returnedByPayment.set(payment.id,returned);
      }
      for(const row of p.settlement_cases||[]){
        checkRecord(row,'settlement case');
        for(const version of [...row.history,row])settlementDocument(version.document,p,row.document);
      }
      function originalOperation(kind,row,idField){
        const ops=root.operations.filter(o=>o.kind===kind&&o.result?.programme_id===p.id&&o.result?.[idField]===row.id);
        need(ops.length===1,'Retain the one complete original '+kind+' request and result.');
        const op=ops[0];need(op.input.programme_id===p.id&&op.input.id===row.id&&op.at===row.recorded_at,'The original financial operation identity or time differs.');
        if(op.result.record_sha256)need(op.result.record_sha256===hash(row),'The complete original financial record differs.');
        return op;
      }
      need(new Set((p.term_changes||[]).map(r=>r.creator_id+'\0'+r.term_id)).size===(p.term_changes||[]).length,'An original agreed term has more than one ending.');
      for(const row of p.term_changes||[]){
        const op=originalOperation('term-end',row,'term_change_id');
        for(const key of ['creator_id','term_id','effective_at','reason','evidence'])need(row[key]===op.input[key],'The retained agreement ending differs from its original '+key+'.');
        need(row.original_creator_revision===op.input.expected_creator_revision&&row.report_sha256===op.input.expected_report_sha256,'The agreement ending lost its original creator revision or reviewed report.');
        const creator=byId(p.creators,row.creator_id,'creator'),original=[...creator.history,creator].find(v=>v.revision===row.original_creator_revision);
        need(original&&original.document.terms.some(t=>t.id===row.term_id&&t.state==='agreed'),'The ending lacks its original agreed creator revision.');
        const first=[...creator.history,creator].find(v=>v.document.terms.some(t=>t.id===row.term_id&&t.state==='agreed'));
        need(Date.parse(row.effective_at)>=Date.parse(first.at),'The recorded ending precedes its original agreed term.');
      }
      for(const row of p.accruals){
        const op=originalOperation('compensation-accrue',row,'accrual_id');
        need(row.creator_id===op.input.creator_id&&row.report_sha256===op.input.expected_report_sha256&&
          row.evidence===op.input.evidence&&row.amount_minor===op.result.amount_minor&&
          row.statement.id===row.creator_id&&row.statement.revision===row.creator_revision&&
          row.statement.pending_earned_minor===row.amount_minor,'The recorded earning differs from its original request, creator revision or accepted statement.');
        const creator=byId(p.creators,row.creator_id,'creator');need([...creator.history,creator].some(v=>v.revision===row.creator_revision),'The original earning creator revision is missing.');
      }
      for(const row of p.payments){
        const op=originalOperation('payment-record',row,'payment_id');
        for(const key of ['creator_id','amount_minor','provider_id','paid_at','evidence'])need(row[key]===op.input[key],'The recorded payment differs from its original '+key+'.');
        need(row.report_sha256===op.input.expected_report_sha256,'The recorded payment lost its original accepted report.');
      }
      for(const row of p.payment_returns||[]){
        const op=originalOperation('payment-return-record',row,'payment_return_id');
        for(const key of ['creator_id','payment_id','amount_minor','provider_id','returned_at','reason','evidence'])need(row[key]===op.input[key],'The retained cash return differs from its original '+key+'.');
        need(row.report_sha256===op.input.expected_report_sha256,'The completed cash return lost its accepted statement.');
      }
      for(const row of p.settlement_cases||[]){
        for(const version of [...row.history,row]){
          const ops=root.operations.filter(op=>op.kind==='settlement-case-save'&&op.result?.programme_id===p.id&&op.result?.settlement_case_id===row.id&&op.result?.revision===version.revision);
          need(ops.length===1,'Retain the complete original request for each settlement-case revision.');
          const op=ops[0];
          need(op.input.programme_id===p.id&&op.input.id===row.id&&op.input.expected_revision===version.revision-1&&op.at===version.at&&
            op.result.document_sha256===version.sha256&&exact(op.input.document,version.document)&&
            /^[a-f0-9]{64}$/.test(op.input.expected_report_sha256),'The original settlement-case revision, request or reviewed statement differs.');
        }
      }
      for(const row of p.costs){
        const op=originalOperation('cost-record',row,'cost_id');
        for(const key of ['category','amount_minor','occurred_at','evidence'])need(row[key]===op.input[key],'The actual cost differs from its original '+key+'.');
      }

    }
    return root;
  }
  function revise(rows,key,document,expected,at,label) {
    const r=rows.find(x=>x.id===key);
    if(r){need(expected===r.revision,'The selected '+label+' changed; review its current edition.',409);
      if(exact(r.document,document))return r;
      r.history.push({revision:r.revision,document:clone(r.document),sha256:r.sha256,at:r.at});
      r.revision++;r.document=clone(document);r.sha256=hash(document);r.at=at;return r;
    }
    need(expected===0,'The original '+label+' does not exist.',409);
    const added={id:id(key),revision:1,document:clone(document),sha256:hash(document),at,history:[]};rows.push(added);return added;
  }
  function configuration(d) {
    need(plain(d),'Supply the complete programme settings.');
    text(d.title,'programme title',300,true);choice(d.evidence_mode,['live','reference'],'the evidence mode');
    need(/^[A-Z]{3}$/.test(d.currency),'Supply the selected currency.');
    date(d.starts_on,'start date');date(d.ends_on,'end date');need(d.ends_on>=d.starts_on,'End after the start date.');
    choice(d.attribution_model,['first_touch','last_touch'],'the attribution model');int(d.attribution_days,'the attribution window in days',1,365);
    need(Array.isArray(d.activation_types)&&d.activation_types.length>0&&d.activation_types.every(x=>['publish','return_usage'].includes(x))&&new Set(d.activation_types).size===d.activation_types.length,'Choose the actual activation event types.');
    int(d.return_min_days,'the minimum return interval',1,90);
    money(d.service_fee_minor);money(d.creator_budget_minor);money(d.other_budget_minor);
    for(const f of ['owner','success_definition','measurement_contract','commercial_status','notes'])text(d[f]??'',f,8000);
    need(plain(d.targets),'Retain the proposed targets.');
    for(const f of ['qualified_creators','signed_partners','activated_users','paying_users'])int(d.targets[f],f,0,10000000);
    return clone(d);
  }
  function creatorDocument(d,p) {
    need(plain(d),'Supply the complete creator record.');
    text(d.name,'creator name',300,true);text(d.lead_id,'original lead ID',160,true);
    need(p.source.bundle.leads.some(l=>l.id===d.lead_id),'Select a creator from the original full lead pack.');
    choice(d.stage,['research','qualified','contacted','discussing','agreed','onboarding','active','declined','paused','closed'],'the creator stage');
    text(d.stage_evidence,'stage evidence',8000);text(d.owner,'responsible operator',300);text(d.platform_user_id??'','actual creator account ID',160);if(d.platform_user_id)id(d.platform_user_id,'actual creator account ID');text(d.contact_route,'original contact route',2000);
    if(!['research','qualified'].includes(d.stage))need(d.stage_evidence.trim(),'Record the actual source for this creator-stage change.');
    need(Array.isArray(d.tracking),'Supply the complete tracking selection.');
    const codes=new Set();for(const t of d.tracking){id(t.id,'tracking-link ID');text(t.code,'tracking code',160,true);need(!codes.has(t.code),'Each creator code must be unique.');codes.add(t.code);url(t.url,'reviewed destination');text(t.source,'tracking setup source',4000,true);}
    need(Array.isArray(d.tasks),'Retain the onboarding and campaign tasks.');
    unique(d.tasks,'tasks');for(const t of d.tasks){text(t.title,'task title',1000,true);choice(t.state,['planned','in_progress','done','not_needed'],'task state');date(t.due_on,'task due date');text(t.evidence,'task evidence',8000);if(t.state==='done')need(t.evidence.trim(),'Record the actual completed task evidence.');}
    need(Array.isArray(d.terms),'Retain the complete partnership terms.');unique(d.terms,'compensation terms');
    for(const t of d.terms){
      choice(t.state,['proposed','agreed','cancelled'],'term state');choice(t.basis,['deliverable','activated_user','paying_user'],'compensation basis');choice(t.user_kind,['creator','fan'],'the explicit compensated user cohort');
      text(t.description,'deliverable or outcome definition',4000,true);money(t.unit_minor);money(t.cap_minor);int(t.max_units,'maximum compensable units',0,10000000);
      text(t.agreement_source,'agreement source',8000);if(t.state==='agreed')need(t.agreement_source.trim(),'Record the actual accepted partnership terms.');
      if(t.basis==='deliverable'){choice(t.acceptance,['pending','accepted','rejected'],'deliverable acceptance');text(t.evidence,'deliverable evidence',8000);if(t.acceptance==='accepted')need(t.state==='agreed'&&t.evidence.trim(),'Keep the accepted terms and actual deliverable source.');}
    }
    return clone(d);
  }
  function settlementDocument(d,p,original=null){
    need(plain(d),'Keep the complete creator settlement case.');
    byId(p.creators,id(d.creator_id),'creator');
    text(d.payment_id,'original payment ID',160);if(d.payment_id){const payment=byId(p.payments,id(d.payment_id),'completed payment');need(payment.creator_id===d.creator_id,'Select the original creator payment.');}
    if(original)need(d.creator_id===original.creator_id&&d.payment_id===original.payment_id,'Keep the original settlement creator and payment; a different selection uses another case.');
    text(d.title,'settlement title',300,true);choice(d.state,['open','in_review','resolved','closed'],'settlement state');
    text(d.owner,'settlement owner',300);text(d.reason,'settlement reason',8000,true);text(d.evidence,'settlement source',8000,true);
    text(d.resolution,'settlement resolution',8000,['resolved','closed'].includes(d.state));
    need(Array.isArray(d.return_ids)&&new Set(d.return_ids).size===d.return_ids.length,'Keep unique related cash-return IDs.');
    for(const key of d.return_ids){const row=byId(p.payment_returns||[],id(key),'completed cash return');need(row.creator_id===d.creator_id&&(!d.payment_id||row.payment_id===d.payment_id),'The settlement return belongs to another creator or payment.');}
    return clone(d);
  }
  function cashStatement(p,creatorId){
    const returns=(p.payment_returns||[]).filter(row=>row.creator_id===creatorId);
    const payments=p.payments.filter(row=>row.creator_id===creatorId).map(payment=>{
      const selected=returns.filter(row=>row.payment_id===payment.id),returned=selected.reduce((n,row)=>n+BigInt(row.amount_minor),0n);
      return {payment_id:payment.id,provider_id:payment.provider_id,paid_at:payment.paid_at,amount_minor:payment.amount_minor,
        returned_minor:returned.toString(),net_paid_minor:(BigInt(payment.amount_minor)-returned).toString(),return_ids:selected.map(row=>row.id)};
    });
    const gross=payments.reduce((n,row)=>n+BigInt(row.amount_minor),0n),returned=returns.reduce((n,row)=>n+BigInt(row.amount_minor),0n);
    return {gross_paid_minor:gross.toString(),returned_minor:returned.toString(),net_paid_minor:(gross-returned).toString(),payments,returns:clone(returns)};
  }
  function sourceDocument(d,p) {
    need(plain(d)&&typeof d.content==='string','Retain the complete original event source.');
    text(d.filename,'source filename',500,true);choice(d.format,['json','csv'],'source format');
    choice(d.evidence_mode,['live','reference'],'source evidence mode');
    choice(d.subject_kind,['creator','fan','mixed'],'the original event cohort');
    need(d.evidence_mode===p.document.evidence_mode,'Keep reference exercises separate from live programme observations.');
    text(d.origin,'original export or collection source',4000,true);text(d.observed_at,'source observation time',100,true);instant(d.observed_at,'source observation');
    need(d.sha256===hashText(d.content),'The complete original source content differs.');
    need(plain(d.mapping),'Supply the complete source-field map.');choice(d.state,['included','excluded'],'source inclusion');text(d.reason,'source decision',4000);
    if(d.state==='excluded')need(d.reason.trim(),'Retain the reason this full source is excluded.');
    parseSource(d,p);return clone(d);
  }
  function csv(text,delimiter) {
    need(typeof delimiter==='string'&&delimiter.length===1&&!['"','\r','\n'].includes(delimiter),'Choose one explicit CSV delimiter.');
    const out=[];let row=[],field='',quoted=false,closed=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
      if(c==='"'){need(field===''&&!closed,'A CSV quote starts inside an unquoted field.');quoted=true;continue;}
      if(c===delimiter){row.push(field);field='';closed=false;continue;}
      if(c==='\r'||c==='\n'){row.push(field);out.push(row);row=[];field='';closed=false;if(c==='\r'&&text[i+1]==='\n')i++;continue;}
      need(!closed,'Characters follow a closed CSV field.');field+=c;
    }
    need(!quoted,'The CSV source ends inside a quoted field.');
    if(field!==''||row.length||closed){row.push(field);out.push(row);}
    need(out.length>0,'The CSV source has no header.');const header=out.shift();header[0]=header[0].replace(/^\uFEFF/,'');
    need(header.every(x=>x!==''&&typeof x==='string')&&new Set(header).size===header.length,'Use unique nonempty CSV column headings.');
    return out.map((r,i)=>{need(r.length===header.length,'CSV parsed record '+(i+2)+' differs from its header width.');return Object.fromEntries(header.map((h,j)=>[h,r[j]]));});
  }
  function parseSource(d,p) {
    let rows;if(d.format==='csv')rows=csv(d.content,d.delimiter);else{try{rows=JSON.parse(d.content);}catch{throw fail('The complete source is not valid JSON.');}need(Array.isArray(rows),'Select a JSON array of event records.');}
    need(rows.length<=100000,'Select at most100,000 complete events per source edition.');
    const m=d.mapping,read=(r,key,required=false)=>{const col=m[key];if(!col){need(!required,'Map '+key+'.');return '';}need(Object.hasOwn(r,col),'The source column '+col+' is absent.');const value=r[col];need(typeof value==='string'||typeof value==='number','Source '+col+' must be a string or exact safe integer.');if(typeof value==='number')need(Number.isSafeInteger(value),'Keep large numeric identifiers and money as strings.');return String(value);};
    return rows.map((r,i)=>{need(plain(r),'Use original event objects.');const e={id:id(read(r,'event_id',true),'native event ID'),type:choice(read(r,'type',true),['click','signup','publish','return_usage','payment','refund'],'event type'),occurred_at:instant(read(r,'occurred_at',true),'event time'),user_kind:d.subject_kind==='mixed'?choice(read(r,'user_kind',true),['creator','fan'],'the original user kind'):d.subject_kind,user_id:read(r,'user_id'),session_id:read(r,'session_id'),creator_code:read(r,'creator_code'),link_id:read(r,'link_id'),related_event_id:read(r,'related_event_id'),amount_minor:read(r,'amount_minor'),platform_revenue_minor:read(r,'platform_revenue_minor'),currency:read(r,'currency'),position:i+(d.format==='csv'?2:1),original:clone(r)};
      need(e.type==='click'||e.user_id,'Non-click events require their actual stable user ID.');
      if(e.user_id)id(e.user_id,'stable source user ID');if(e.session_id)id(e.session_id,'source session ID');
      if(['payment','refund'].includes(e.type)){money(e.amount_minor);need(e.currency===p.document.currency,'Event currency differs; receive the correct currency explicitly.');if(e.platform_revenue_minor!=='')money(e.platform_revenue_minor);if(e.type==='refund')id(e.related_event_id,'the original payment event ID');}
      else need(e.amount_minor===''&&e.platform_revenue_minor==='','Monetary values belong to payment/refund events.');
      return e;
    });
  }
  function apply(ledger,body,at=new Date().toISOString()) {
    const root=validate(ledger);need(plain(body)&&plain(body.input),'Supply the complete saved operation.');
    id(body.operation_id,'operation ID');instant(at,'operation time');
    const requestHash=hash({kind:body.kind,input:body.input,expected_root_sha256:body.expected_root_sha256});
    const old=root.operations.find(r=>r.id===body.operation_id);
    if(old){need(old.request_sha256===requestHash,'This operation ID belongs to different complete inputs.',409);return {ledger,changed:false,replayed:true,...clone(old.result)};}
    need(body.expected_root_sha256===hash(root),'The creator workspace changed; retain this request and review current work.',409);
    const input=body.input;let p,result;
    if(body.kind==='programme-create'){
      id(input.id);need(!root.programmes.some(x=>x.id===input.id),'This original programme already exists.',409);
      validateLeadPack(input.lead_pack);const config=configuration(input.document);
      p=revise(root.programmes,input.id,config,0,at,'programme');
      Object.assign(p,{pack_id:input.lead_pack.pack.id,source:{bundle:clone(input.lead_pack),sha256:hash(input.lead_pack)},creators:[],sources:[],decisions:[],accruals:[],payments:[],costs:[],term_changes:[]});
      result={programme_id:p.id,revision:p.revision};
    }else if(body.kind==='programme-receive'){
      const bundle=input.bundle;let reviewed=null;
      if(input.report_review!==undefined){
        need(plain(input.report_review),'Keep the complete handover report review.');
        reviewed=reviewBundle(bundle);
        need(input.report_review.sha256===reviewed.sha256,'The original handover or current calculation changed after review; reopen both reports.',409);
        text(input.report_review.reason,'reason for receiving the retained report',8000,true);
      }else validateBundle(bundle);
      p=root.programmes.find(x=>x.id===bundle.programme.id);
      if(p){need(exact(p,bundle.programme),'The received programme differs from existing work; preserve both editions.',409);result={programme_id:p.id,received:true,unchanged:true};}
      else{p=clone(bundle.programme);root.programmes.push(p);result={programme_id:p.id,received:true,unchanged:false};}
      for(const incoming of bundle.operations){const previous=root.operations.find(o=>o.id===incoming.id);need(!previous||exact(previous,incoming),'The received original operation ID contains different inputs or results.',409);if(!previous)root.operations.push(clone(incoming));}
      if(reviewed)result.report_review={version:REPORT_REVIEW,review_sha256:reviewed.sha256,
        bundle_sha256:reviewed.bundle_sha256,programme_sha256:reviewed.programme_sha256,
        original_report_sha256:reviewed.original_report.sha256,current_report:clone(reviewed.current_report),
        report_matches:reviewed.report_matches,reason:input.report_review.reason};
    }else{
      p=byId(root.programmes,input.programme_id,'programme');
      if(body.kind==='programme-save'){
        const d=configuration(input.document);need(d.currency===p.document.currency&&d.evidence_mode===p.document.evidence_mode,'Preserve this original currency and evidence mode.');
        revise(root.programmes,p.id,d,input.expected_revision,at,'programme');result={programme_id:p.id,revision:p.revision};
      }else if(body.kind==='creator-save'){
        const d=creatorDocument(input.document,p);id(input.id);
        for(const c of p.creators.filter(c=>c.id!==input.id))for(const t of c.document.tracking)need(!d.tracking.some(x=>x.id===t.id||x.code===t.code),'A tracking code or link is already assigned to another original creator.');
        const previous=p.creators.find(c=>c.id===input.id);
        if(previous){
          for(const oldTerm of previous.document.terms.filter(t=>t.state==='agreed')){
            const current=d.terms.find(t=>t.id===oldTerm.id);
            const fixed=t=>Object.fromEntries(Object.entries(t).filter(([key])=>!['acceptance','evidence'].includes(key)));
            need(current&&exact(fixed(oldTerm),fixed(current)),'Preserve agreed compensation terms and IDs; a following agreement uses a new term.');
            if(oldTerm.acceptance==='accepted')need(current.acceptance==='accepted'&&current.evidence===oldTerm.evidence,'Preserve the actual accepted deliverable and its compensation evidence.');
          }
          need(previous.document.lead_id===d.lead_id,'Keep the original creator/source relationship.');for(const t of previous.document.tracking)need(d.tracking.some(x=>exact(x,t)),'Retain previously issued tracking links/codes unchanged.');}
        const c=revise(p.creators,input.id,d,input.expected_revision,at,'creator');result={programme_id:p.id,creator_id:c.id,revision:c.revision};
      }else if(body.kind==='term-end'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'Review the current programme before ending an agreement.',409);
        const creator=byId(p.creators,id(input.creator_id),'creator');
        need(creator.revision===input.expected_creator_revision,'The original creator agreement changed before review.',409);
        const term=byId(creator.document.terms,id(input.term_id),'agreed term');
        need(term.state==='agreed','End an existing agreed term; retain its original agreement.');
        need(!(p.term_changes||[]).some(t=>t.creator_id===creator.id&&t.term_id===term.id),'This original agreement already has its recorded termination.',409);
        id(input.id);instant(input.effective_at,'termination effective time');
        const accepted=[...creator.history,creator].find(v=>v.document.terms.some(t=>t.id===term.id&&t.state==='agreed'));
        need(Date.parse(input.effective_at)>=Date.parse(accepted.at),'The effective end cannot precede the recorded original agreement.');
        (p.term_changes??=[]).push({id:input.id,creator_id:creator.id,term_id:term.id,effective_at:input.effective_at,
          reason:text(input.reason,'termination reason',8000,true),evidence:text(input.evidence,'termination evidence',8000,true),
          original_creator_revision:creator.revision,report_sha256:current.sha256,recorded_at:at});
        result={programme_id:p.id,term_change_id:input.id,record_sha256:hash(p.term_changes[p.term_changes.length-1])};
      }else if(body.kind==='source-save'){
        const d=sourceDocument(input.document,p);const r=revise(p.sources,id(input.id),d,input.expected_revision,at,'source');
        result={programme_id:p.id,source_id:r.id,revision:r.revision,records:parseSource(d,p).length};
      }else if(body.kind==='attribution-decide'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'The actual event/report selection changed before attribution review.',409);
        id(input.id);need(!p.decisions.some(x=>x.id===input.id),'This reviewed attribution is already retained.',409);
        const user=byId(current.users,id(input.user_id),'observed user');
        need(input.creator_id===null||p.creators.some(c=>c.id===input.creator_id),'Choose an existing creator or explicit unassigned attribution.');
        const d={user_id:user.id,creator_id:input.creator_id,reason:text(input.reason,'attribution decision',8000,true),evidence:text(input.evidence,'attribution evidence',8000,true),event_basis_sha256:user.event_basis_sha256,report_sha256:current.sha256};
        p.decisions.push({id:input.id,at,document:d,sha256:hash(d)});result={programme_id:p.id,decision_id:input.id};
      }else if(body.kind==='compensation-accrue'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'The source statement changed before earning was recorded.',409);
        id(input.id);need(!p.accruals.some(x=>x.id===input.id),'This compensation accrual already exists.',409);
        const c=byId(current.creators,id(input.creator_id),'creator statement');
        need(BigInt(c.pending_earned_minor)>0n,'The current statement has no additional unrecorded earned amount.');
        text(input.evidence,'accepted earning evidence',8000,true);
        p.accruals.push({id:input.id,creator_id:c.id,amount_minor:c.pending_earned_minor,currency:p.document.currency,
          report_sha256:current.sha256,creator_revision:byId(p.creators,c.id,'creator').revision,
          statement:clone(c),evidence:input.evidence,recorded_at:at});
        result={programme_id:p.id,accrual_id:input.id,amount_minor:c.pending_earned_minor,record_sha256:hash(p.accruals[p.accruals.length-1])};
      }else if(body.kind==='payment-record'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'The earned compensation changed; review the current statement.',409);
        id(input.id);need(!p.payments.some(x=>x.id===input.id),'This payment record already exists.',409);
        const c=byId(current.creators,id(input.creator_id),'creator statement');money(input.amount_minor);need(BigInt(input.amount_minor)>0n&&BigInt(input.amount_minor)<=BigInt(c.unpaid_earned_minor),'Record only an actual positive payment within the current unpaid earned amount.');
        text(input.provider_id,'actual payment reference',1000,true);need(!p.payments.some(x=>x.provider_id===input.provider_id)&&!(p.payment_returns||[]).some(x=>x.provider_id===input.provider_id),'The actual cash reference is already recorded.',409);
        instant(input.paid_at,'actual payment time');need(Date.parse(input.paid_at)<=Date.parse(at),'A completed payment cannot be in the future.');
        p.payments.push({id:input.id,creator_id:input.creator_id,amount_minor:input.amount_minor,currency:p.document.currency,provider_id:input.provider_id,paid_at:input.paid_at,evidence:text(input.evidence,'payment evidence',8000,true),report_sha256:current.sha256,recorded_at:at});
        result={programme_id:p.id,payment_id:input.id,record_sha256:hash(p.payments[p.payments.length-1])};
      }else if(body.kind==='payment-return-record'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'The creator cash statement changed; review it before recording the return.',409);
        id(input.id);need(!(p.payment_returns||[]).some(row=>row.id===input.id),'This cash return is already retained.',409);
        const payment=byId(p.payments,id(input.payment_id),'completed creator payment');
        need(payment.creator_id===id(input.creator_id),'Select the original creator for this payment.');
        const returned=(p.payment_returns||[]).filter(row=>row.payment_id===payment.id).reduce((n,row)=>n+BigInt(row.amount_minor),0n);
        money(input.amount_minor);need(BigInt(input.amount_minor)>0n&&BigInt(input.amount_minor)<=BigInt(payment.amount_minor)-returned,'Record only a completed positive cash return within the original payment balance.');
        text(input.provider_id,'actual return reference',1000,true);
        need(!p.payments.some(row=>row.provider_id===input.provider_id)&&!(p.payment_returns||[]).some(row=>row.provider_id===input.provider_id),'The actual cash reference is already retained.',409);
        instant(input.returned_at,'actual cash return time');need(Date.parse(input.returned_at)>=Date.parse(payment.paid_at)&&Date.parse(input.returned_at)<=Date.parse(at),'The completed return must follow its original payment and cannot be in the future.');
        const row={id:input.id,creator_id:payment.creator_id,payment_id:payment.id,amount_minor:input.amount_minor,currency:payment.currency,
          provider_id:input.provider_id,returned_at:input.returned_at,reason:text(input.reason,'cash return reason',8000,true),
          evidence:text(input.evidence,'cash return evidence',8000,true),report_sha256:current.sha256,recorded_at:at};
        (p.payment_returns??=[]).push(row);result={programme_id:p.id,payment_return_id:row.id,record_sha256:hash(row)};
      }else if(body.kind==='settlement-case-save'){
        const current=report(p);need(input.expected_report_sha256===current.sha256,'The original creator statement changed; review the current case before saving.',409);
        id(input.id);const previous=(p.settlement_cases||[]).find(row=>row.id===input.id),document=settlementDocument(input.document,p,previous?.document);
        const row=revise(p.settlement_cases??=[],input.id,document,input.expected_revision,at,'settlement case');
        if(previous&&row.revision===input.expected_revision)throw fail('This exact settlement case is already saved; retain its original request.',409);
        result={programme_id:p.id,settlement_case_id:row.id,revision:row.revision,document_sha256:row.sha256};
      }else if(body.kind==='cost-record'){
        id(input.id);need(!p.costs.some(x=>x.id===input.id),'This actual cost is already recorded.',409);
        choice(input.category,['service','advertising','other'],'cost category');money(input.amount_minor);instant(input.occurred_at,'actual cost time');need(Date.parse(input.occurred_at)<=Date.parse(at),'An actual cost cannot be in the future.');
        p.costs.push({id:input.id,category:input.category,amount_minor:input.amount_minor,currency:p.document.currency,occurred_at:input.occurred_at,evidence:text(input.evidence,'cost source',8000,true),recorded_at:at});
        result={programme_id:p.id,cost_id:input.id,record_sha256:hash(p.costs[p.costs.length-1])};
      }else throw fail('Choose a supported creator-programme operation.');
    }
    root.operations.push({id:body.operation_id,kind:body.kind,input:clone(input),expected_root_sha256:body.expected_root_sha256,request_sha256:requestHash,at,result:clone(result)});
    const next={...ledger,creator_programmes:root};validate(next);
    return {ledger:next,changed:true,replayed:false,...result};
  }

  function report(p) {
    const config=p.document,start=Date.parse(config.starts_on+'T00:00:00Z'),end=Date.parse(config.ends_on+'T23:59:59.999Z');
    const findings=[],events=new Map(),conflicts=new Set(),candidateEvents=[],unresolvedPayments=new Map();
    const sourcesById=new Map(p.sources.map(source=>[source.id,source]));
    const addFinding=(code,message,details={})=>findings.push({code,message,...details});
    for(const source of p.sources.filter(s=>s.document.state==='included')){
      for(const event of parseSource(source.document,p)){
        const {position,original,...semantic}=event,reference={source_id:source.id,revision:source.revision,source_sha256:source.document.sha256,position,original};
        const existing=events.get(event.id);
        if(existing&&!exact(existing.semantic,semantic)){conflicts.add(event.id);existing.references.push(reference);(existing.semantic_versions??=[clone(existing.semantic)]).push(clone(semantic));}
        else if(existing)existing.references.push(reference);
        else events.set(event.id,{...event,semantic,references:[reference]});
      }
    }
    for(const e of events.values()){
      if(conflicts.has(e.id)){
        const candidates=e.semantic_versions||[e.semantic];
        for(const v of candidates)if(v.type==='refund'&&v.related_event_id){const ids=unresolvedPayments.get(v.related_event_id)||[];if(!ids.includes(e.id))ids.push(e.id);unresolvedPayments.set(v.related_event_id,ids);}
        addFinding('EVENT_ID_CONFLICT','Different source values use one native event ID; none is counted.',{event_id:e.id,references:e.references,semantic_versions:candidates});continue;
      }
      if(e.references.length>1)addFinding('EXACT_EVENT_DUPLICATE','The exact native event is retained from each source and counted once.',{event_id:e.id,references:e.references});
      if(e.references.some(r=>Date.parse(e.occurred_at)>Date.parse(sourcesById.get(r.source_id).document.observed_at))){addFinding('FUTURE_SOURCE_EVENT','An event occurs after its source observation; it remains retained and is excluded.',{event_id:e.id,references:e.references});continue;}
      candidateEvents.push(e);
    }
    // A refund references a native payment globally; another user/kind cannot
    // leave that original payment counted as unrefunded revenue.
    for(const refund of candidateEvents.filter(e=>e.type==='refund')){
      const payment=events.get(refund.related_event_id);
      if(payment&&payment.type==='payment'&&(payment.user_id!==refund.user_id||payment.user_kind!==refund.user_kind||payment.currency!==refund.currency)){
        const ids=unresolvedPayments.get(payment.id)||[];if(!ids.includes(refund.id))ids.push(refund.id);unresolvedPayments.set(payment.id,ids);
        addFinding('REFUND_IDENTITY_MISMATCH','The refund and its actual related payment disagree on user, cohort or currency; the payment group is excluded.',{event_id:refund.id,related_event_id:payment.id,refund:clone(refund.semantic),payment:clone(payment.semantic)});
      }
    }
    candidateEvents.sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||a.id.localeCompare(b.id));
    // Index the original sorted events once. Later selections preserve their
    // timestamp/ID order, including tied attribution and complete source references.
    const eventsByUser=new Map(),anonymousTouchesBySession=new Map(),eventOrder=new Map();
    const append=(index,key,event)=>{let rows=index.get(key);if(!rows){rows=[];index.set(key,rows);}rows.push(event);};
    candidateEvents.forEach((event,position)=>{
      eventOrder.set(event.id,position);
      if(event.user_id)append(eventsByUser,event.user_id,event);
      else if(event.session_id&&['click','signup'].includes(event.type))append(anonymousTouchesBySession,event.session_id,event);
    });
    const codes=new Map(),links=new Map(),creatorAccounts=new Map();
    for(const c of p.creators){
      if(c.document.platform_user_id){const old=creatorAccounts.get(c.document.platform_user_id);if(old&&old!==c.id)addFinding('CREATOR_ACCOUNT_CONFLICT','The same actual account is assigned to different creators.',{user_id:c.document.platform_user_id});creatorAccounts.set(c.document.platform_user_id,c.id);}
      for(const t of c.document.tracking){codes.set(t.code,c.id);links.set(t.id,c.id);}
    }
    function candidates(e){
      const selected=[];if(e.creator_code){if(codes.has(e.creator_code))selected.push(codes.get(e.creator_code));else addFinding('UNKNOWN_CODE','The original event has an unregistered creator code.',{event_id:e.id,creator_code:e.creator_code});}
      if(e.link_id){if(links.has(e.link_id))selected.push(links.get(e.link_id));else addFinding('UNKNOWN_LINK','The original event has an unregistered tracking-link ID.',{event_id:e.id,link_id:e.link_id});}
      return [...new Set(selected)].sort();
    }
    const users=[],identities=[...eventsByUser.keys()].sort();
    const currentDecisions=new Map();for(const d of p.decisions)currentDecisions.set(d.document.user_id,d);
    for(const userId of identities){
      const own=eventsByUser.get(userId),kinds=[...new Set(own.map(e=>e.user_kind))];
      if(kinds.length!==1){addFinding('USER_KIND_CONFLICT','The same stable user has different creator/fan classifications.',{user_id:userId,event_ids:own.map(e=>e.id)});continue;}
      const kind=kinds[0],signups=own.filter(e=>e.type==='signup'),signup=signups[0];
      if(!signup){addFinding('SIGNUP_MISSING','Activity has no original signup in the selected complete sources.',{user_id:userId,event_ids:own.map(e=>e.id)});continue;}
      if(signups.length>1)addFinding('MULTIPLE_SIGNUPS','The earliest observed signup is used; later signup records are retained.',{user_id:userId,event_ids:signups.map(e=>e.id)});
      const signupTime=Date.parse(signup.occurred_at),within=signupTime>=start&&signupTime<=end;
      const sessions=new Set(own.filter(e=>e.session_id).map(e=>e.session_id));
      const relevantTouches=own.filter(e=>['click','signup'].includes(e.type));
      for(const session of sessions)for(const event of anonymousTouchesBySession.get(session)||[])relevantTouches.push(event);
      relevantTouches.sort((a,b)=>eventOrder.get(a.id)-eventOrder.get(b.id));
      const touches=relevantTouches.filter(e=>(e.user_id===userId||!e.user_id&&e.session_id&&sessions.has(e.session_id))&&
        ['click','signup'].includes(e.type)&&Date.parse(e.occurred_at)<=signupTime&&
        signupTime-Date.parse(e.occurred_at)<=config.attribution_days*86400000)
        .map(e=>({event_id:e.id,occurred_at:e.occurred_at,semantic:clone(e.semantic),candidates:candidates(e),unresolved:Boolean(e.creator_code&&!codes.has(e.creator_code)||e.link_id&&!links.has(e.link_id))})).filter(e=>e.candidates.length||e.unresolved);
      let creator=null,attribution='unattributed';
      const selected=config.attribution_model==='first_touch'?touches[0]:touches[touches.length-1];
      if(selected){
        const tied=touches.filter(t=>Date.parse(t.occurred_at)===Date.parse(selected.occurred_at));
        const choices=[...new Set(tied.flatMap(t=>t.candidates))];
        if(choices.length===1&&!tied.some(t=>t.unresolved)){creator=choices[0];attribution=config.attribution_model;}
        else {attribution='ambiguous';addFinding('ATTRIBUTION_AMBIGUOUS','Equal-time touches or conflicting code/link references need an explicit review.',{user_id:userId,candidates:choices});}
      }
      const eventBasis=hash({events:own.map(e=>e.semantic),touches,attribution_model:config.attribution_model,attribution_days:config.attribution_days});
      const decision=currentDecisions.get(userId);
      if(decision){
        if(decision.document.event_basis_sha256===eventBasis){creator=decision.document.creator_id;attribution=creator?'reviewed':'reviewed_unassigned';}
        else addFinding('ATTRIBUTION_REVIEW_STALE','The original evidence changed after the retained attribution review; review it again.',{user_id:userId,decision_id:decision.id});
      }
      const activity=own.filter(e=>Date.parse(e.occurred_at)>=signupTime&&Date.parse(e.occurred_at)<=end);
      const before=own.filter(e=>Date.parse(e.occurred_at)<signupTime);if(before.some(e=>!['click','signup'].includes(e.type)))addFinding('ACTIVITY_BEFORE_SIGNUP','Earlier activity is retained and excluded from the signup cohort.',{user_id:userId,event_ids:before.map(e=>e.id)});
      const activations=activity.filter(e=>config.activation_types.includes(e.type)&&
        (e.type!=='return_usage'||Date.parse(e.occurred_at)-signupTime>=config.return_min_days*86400000));
      const payments=activity.filter(e=>e.type==='payment'),paymentIds=new Map(payments.map(e=>[e.id,e]));
      const refunds=activity.filter(e=>e.type==='refund');let gross=0n,net=0n,platform=0n,platformKnown=true;
      const includedPayments=[],positivePayments=[],paymentGroups=[],refundsByPayment=new Map();
      for(const refund of refunds)append(refundsByPayment,refund.related_event_id,refund);
      for(const pay of payments){
        if(unresolvedPayments.has(pay.id)){addFinding('REFUND_SOURCE_CONFLICT','Conflicting original refund evidence leaves this complete payment group unresolved and excluded.',{user_id:userId,event_id:pay.id,refund_ids:unresolvedPayments.get(pay.id)});continue;}
        const returned=refundsByPayment.get(pay.id)||[];
        const total=returned.reduce((v,r)=>v+BigInt(r.amount_minor),0n);
        const platformRefunds=returned.reduce((v,r)=>v+(r.platform_revenue_minor===''?0n:BigInt(r.platform_revenue_minor)),0n);
        if(total>BigInt(pay.amount_minor)||returned.some(r=>Date.parse(r.occurred_at)<Date.parse(pay.occurred_at))||
          pay.platform_revenue_minor!==''&&platformRefunds>BigInt(pay.platform_revenue_minor)){
          addFinding('REFUND_MISMATCH','Refunds exceed or precede their actual original payment; that payment group is not counted.',{user_id:userId,event_id:pay.id,refund_ids:returned.map(r=>r.id)});continue;
        }
        const amount=BigInt(pay.amount_minor);gross+=amount;net+=amount-total;includedPayments.push(pay.id);
        if(amount>total)positivePayments.push(pay.id);
        paymentGroups.push({payment_event_id:pay.id,occurred_at:pay.occurred_at,gross_minor:amount.toString(),refund_minor:total.toString(),net_minor:(amount-total).toString(),refund_event_ids:returned.map(r=>r.id)});
        if(pay.platform_revenue_minor===''||returned.some(r=>r.platform_revenue_minor===''))platformKnown=false;
        else platform+=BigInt(pay.platform_revenue_minor)-platformRefunds;
      }
      for(const r of refunds)if(!paymentIds.has(r.related_event_id))addFinding('REFUND_PAYMENT_MISSING','The selected sources lack the related original payment for this user.',{user_id:userId,event_id:r.id,related_event_id:r.related_event_id});
      const self=kind==='fan'&&creatorAccounts.has(userId);
      if(self)addFinding('CREATOR_ACCOUNT_AS_FAN','An actual creator account appears in the fan cohort; exclude it from performance compensation until corrected.',{user_id:userId});
      users.push({id:userId,user_kind:kind,signup_event_id:signup.id,signup_at:signup.occurred_at,in_period:within,
        creator_id:creator,attribution,attribution_decision_id:decision?.document.event_basis_sha256===eventBasis?decision.id:null,
        event_basis_sha256:eventBasis,touches,event_ids:own.map(e=>e.id),activation_event_ids:activations.map(e=>e.id),
        activated:within&&activations.length>0,paying:within&&net>0n,performance_eligible:within&&!self,
        gross_payment_minor:gross.toString(),net_payment_minor:net.toString(),
        platform_revenue_minor:platformKnown?platform.toString():null,payment_event_ids:includedPayments,positive_payment_event_ids:positivePayments,payment_groups:paymentGroups});
    }
    const eligibleByCreator=new Map(),accrualRowsByCreator=new Map(),accruedByCreator=new Map(),paidByCreator=new Map();
    for(const user of users)if(user.creator_id&&user.performance_eligible)append(eligibleByCreator,user.creator_id,user);
    for(const row of p.accruals){append(accrualRowsByCreator,row.creator_id,row);accruedByCreator.set(row.creator_id,(accruedByCreator.get(row.creator_id)||0n)+BigInt(row.amount_minor));}
    for(const row of p.payments)paidByCreator.set(row.creator_id,(paidByCreator.get(row.creator_id)||0n)+BigInt(row.amount_minor));
    const creators=p.creators.map(c=>{
      const attributed=eligibleByCreator.get(c.id)||[];
      const statement=[],agreed=c.document.terms.filter(t=>t.state==='agreed');
      let calculated=0n,committed=0n;
      for(const term of agreed){
        const cohort=attributed.filter(u=>u.user_kind===term.user_kind);
        const ended=(p.term_changes||[]).find(t=>t.creator_id===c.id&&t.term_id===term.id),cutoff=ended?Date.parse(ended.effective_at):Infinity;
        const acceptedVersion=[...c.history,c].find(v=>v.document.terms.some(t=>t.id===term.id&&t.acceptance==='accepted'));
        const acceptedBeforeEnd=acceptedVersion&&Date.parse(acceptedVersion.at)<cutoff;
        const evidence=term.basis==='deliverable'?term.acceptance==='accepted'&&acceptedBeforeEnd?[term.evidence]:[]:
          cohort.filter(u=>term.basis==='activated_user'?u.activated&&u.activation_event_ids.some(key=>Date.parse(events.get(key).occurred_at)<cutoff):
            u.paying&&u.positive_payment_event_ids.some(key=>Date.parse(events.get(key).occurred_at)<cutoff)).map(u=>u.id).sort();
        const unit=value=>({id:hash({creator_id:c.id,term_id:term.id,basis:term.basis,user_kind:term.user_kind,
          subject:term.basis==='deliverable'?term.id:value}),subject:term.basis==='deliverable'?term.id:value,evidence:value});
        const originalUnits=new Map();
        for(const accrued of accrualRowsByCreator.get(c.id)||[]){
          const prior=accrued.statement.terms?.find(t=>t.term_id===term.id);if(!prior)continue;
          const retained=prior.credited_units||prior.evidence.slice(0,prior.units).map(unit);
          for(const u of retained){const old=originalUnits.get(u.id);need(!old||exact(old,u),'An original compensated unit changed.');originalUnits.set(u.id,clone(u));}
        }
        const combined=new Map(originalUnits);
        for(const value of evidence){const u=unit(value);if(!combined.has(u.id))combined.set(u.id,u);}
        const credited=[...combined.values()].slice(0,term.max_units);
        const unlimited=BigInt(term.unit_minor)*BigInt(credited.length),currentAmount=BigInt(term.unit_minor)*BigInt(Math.min(evidence.length,term.max_units));
        const earned=unlimited>BigInt(term.cap_minor)?BigInt(term.cap_minor):unlimited;
        const currentEarned=currentAmount>BigInt(term.cap_minor)?BigInt(term.cap_minor):currentAmount;
        const cap=BigInt(term.unit_minor)*BigInt(term.max_units);committed+=ended?earned:cap>BigInt(term.cap_minor)?BigInt(term.cap_minor):cap;
        calculated+=earned;statement.push({term_id:term.id,basis:term.basis,user_kind:term.user_kind,unit_minor:term.unit_minor,
          units:credited.length,evidence,ended:ended?clone(ended):null,credited_units:credited,previously_recorded_unit_ids:[...originalUnits.keys()],
          new_unit_ids:credited.filter(u=>!originalUnits.has(u.id)).map(u=>u.id),
          current_eligible_earned_minor:currentEarned.toString(),cap_minor:term.cap_minor,earned_minor:earned.toString(),agreement_source:term.agreement_source});
      }
      const accrued=accruedByCreator.get(c.id)||0n;
      const paid=paidByCreator.get(c.id)||0n,cash=cashStatement(p,c.id),netPaid=BigInt(cash.net_paid_minor);
      need(netPaid>=0n&&netPaid<=accrued,'The original net creator payments exceed retained earned compensation.');
      if(accrued>calculated)addFinding('RECORDED_EARNING_EXCEEDS_CURRENT_CALCULATION','A changed current source/report does not erase the original recorded creator earning. Review the difference with its original terms.',{creator_id:c.id,recorded_minor:accrued.toString(),calculated_minor:calculated.toString()});
      return {id:c.id,name:c.document.name,stage:c.document.stage,revision:c.revision,cohorts:Object.fromEntries(['creator','fan'].map(kind=>{
        const rows=attributed.filter(u=>u.user_kind===kind);return [kind,{signups:rows.length,activated:rows.filter(u=>u.activated).length,paying:rows.filter(u=>u.paying).length}];})),
        committed_minor:committed.toString(),current_eligible_earned_minor:statement.reduce((n,t)=>n+BigInt(t.current_eligible_earned_minor),0n).toString(),calculated_earned_minor:calculated.toString(),recorded_earned_minor:accrued.toString(),
        pending_earned_minor:(calculated>accrued?calculated-accrued:0n).toString(),paid_minor:paid.toString(),
        unpaid_earned_minor:(accrued-netPaid).toString(),terms:statement,...((p.payment_returns||[]).length||(p.settlement_cases||[]).length?{cash}:{})};
    });
    const selectedUsers=users.filter(u=>u.in_period),sum=(rows,key)=>rows.reduce((n,r)=>n+BigInt(r[key]),0n).toString();
    const actualCosts=sum(p.costs,'amount_minor'),creatorPaid=sum(creators,'paid_minor'),accrued=sum(creators,'recorded_earned_minor');
    const budget=BigInt(config.service_fee_minor)+BigInt(config.creator_budget_minor)+BigInt(config.other_budget_minor);
    const hasSettlement=(p.payment_returns||[]).length>0||(p.settlement_cases||[]).length>0;
    const creatorReturned=(p.payment_returns||[]).reduce((n,row)=>n+BigInt(row.amount_minor),0n),netCreatorPaid=BigInt(creatorPaid)-creatorReturned;
    const grossSpend=BigInt(actualCosts)+BigInt(creatorPaid),totalSpend=BigInt(actualCosts)+netCreatorPaid,acquired=selectedUsers.filter(u=>u.performance_eligible&&u.creator_id&&u.paying).length;
    const allRevenueKnown=selectedUsers.every(u=>u.platform_revenue_minor!==null);
    const revenue=allRevenueKnown?sum(selectedUsers,'platform_revenue_minor'):null;
    const data={version:'dealscout.creator-programme-report.v1',programme_id:p.id,programme_revision:p.revision,pack_id:p.pack_id,
      source_pack_sha256:p.source.sha256,evidence_mode:config.evidence_mode,currency:config.currency,period:{starts_on:config.starts_on,ends_on:config.ends_on,timezone:'UTC'},
      selected_sources:p.sources.map(s=>({id:s.id,revision:s.revision,sha256:s.document.sha256,state:s.document.state,origin:s.document.origin})),
      targets:clone(config.targets),cohorts:Object.fromEntries(['creator','fan'].map(kind=>{
        const rows=selectedUsers.filter(u=>u.user_kind===kind);return [kind,{signups:rows.length,activated:rows.filter(u=>u.activated).length,paying:rows.filter(u=>u.paying).length,attributed:rows.filter(u=>u.creator_id).length,unattributed:rows.filter(u=>!u.creator_id).length}];})),
      users,creators,findings,events:candidateEvents.map(e=>({event_id:e.id,semantic:clone(e.semantic),references:clone(e.references)})),
      economics:{planned_service_fee_minor:config.service_fee_minor,planned_creator_budget_minor:config.creator_budget_minor,
        planned_other_budget_minor:config.other_budget_minor,total_budget_minor:budget.toString(),
        gross_fan_payment_minor:sum(selectedUsers.filter(u=>u.user_kind==='fan'),'gross_payment_minor'),
        net_fan_payment_minor:sum(selectedUsers.filter(u=>u.user_kind==='fan'),'net_payment_minor'),
        platform_revenue_minor:revenue,creator_committed_minor:sum(creators,'committed_minor'),
        creator_recorded_earned_minor:accrued,creator_paid_minor:creatorPaid,other_actual_cost_minor:actualCosts,
        actual_total_spend_minor:totalSpend.toString(),budget_remaining_minor:(budget-totalSpend).toString(),
        observed_platform_contribution_minor:revenue===null?null:(BigInt(revenue)-totalSpend).toString(),
        cost_per_attributed_paying_user:acquired?{numerator_minor:totalSpend.toString(),denominator_users:acquired}:null,
        ...(hasSettlement?{creator_returned_minor:creatorReturned.toString(),creator_net_paid_minor:netCreatorPaid.toString(),gross_total_spend_minor:grossSpend.toString()}:{})},
      ...(hasSettlement?{settlement_cases:clone(p.settlement_cases||[])}:{}),
      meaning:{targets:'Proposed planning values; actual source observations are shown separately.',
        attribution:'Observed attribution follows the selected model and reviewed source evidence; it does not establish causation.',
        revenue:'Fan purchases and platform revenue are separate. A missing actual platform-revenue field stays unknown.',
        compensation:'Accepted, recorded earning remains preserved if a later source changes. Cash is recorded only with an actual payment reference.',
        ...(hasSettlement?{settlement:'Returned cash reduces net spending and reopens the unpaid recorded earning. A settlement-case status preserves the accepted earning and does not itself change or waive it.'}:{})}};
    return {...data,sha256:hash(data)};
  }
  function sourceSelection(ledger,key){
    const root=validate(ledger),p=byId(root.programmes,key,'programme'),full=exportProgramme(ledger,key);
    const selectedDocument=value=>{const d=clone(value);delete d.operating_plan;return d;};
    const documentVersion=v=>({revision:v.revision,at:v.at,original_document_sha256:v.sha256,
      document:selectedDocument(v.document),selected_document_sha256:hash(selectedDocument(v.document))});
    const selection={version:'dealscout.creator-programme-source-selection.v1',programme_id:p.id,pack_id:p.pack_id,
      full_programme_sha256:hash(p),full_handover_sha256:full.sha256,
      selection:{omitted_programme_document_fields:['operating_plan'],
        operation_inputs:'Original complete request bodies remain in the full handover; this selection carries their exact indexes.',
        purpose:'Nonrecursive business source for the existing operating Plan and Return workflow.'},
      programme:{id:p.id,pack_id:p.pack_id,...documentVersion(p),history:p.history.map(documentVersion)},
      original_lead_source:{bundle_sha256:p.source.sha256,pack:clone(p.source.bundle.pack),leads:clone(p.source.bundle.leads)},
      creators:clone(p.creators),sources:clone(p.sources),decisions:clone(p.decisions),accruals:clone(p.accruals),
      payments:clone(p.payments),costs:clone(p.costs),term_changes:clone(p.term_changes||[]),
      ...((p.payment_returns||[]).length||(p.settlement_cases||[]).length?{payment_returns:clone(p.payment_returns||[]),settlement_cases:clone(p.settlement_cases||[])}:{}),
      operation_index:full.operations.map(o=>({id:o.id,kind:o.kind,request_sha256:o.request_sha256,at:o.at,result:clone(o.result)})),
      report:report(p)};
    return {...selection,sha256:hash(selection)};
  }
  /** Check the retained report's complete source selection, independently of calculation edition. */
  function reportSource(p,value){
    need(plain(value)&&value.version==='dealscout.creator-programme-report.v1','Keep the complete original programme report.');
    const {sha256,...body}=value;need(sha256===hash(body),'The retained complete report changed.');
    const identity={programme_id:p.id,programme_revision:p.revision,pack_id:p.pack_id,
      source_pack_sha256:p.source.sha256,evidence_mode:p.document.evidence_mode,currency:p.document.currency,
      period:{starts_on:p.document.starts_on,ends_on:p.document.ends_on,timezone:'UTC'},targets:p.document.targets,
      selected_sources:p.sources.map(row=>({id:row.id,revision:row.revision,sha256:row.document.sha256,state:row.document.state,origin:row.document.origin}))};
    for(const [key,expected] of Object.entries(identity))need(value[key]!==undefined&&exact(value[key],expected),'The retained report lost its original '+key+'.');
    for(const key of ['users','creators','findings','events'])need(Array.isArray(value[key]),'Keep every original report '+key+' row.');
    need(plain(value.cohorts)&&plain(value.economics)&&plain(value.meaning),'Keep the complete report outcomes and definitions.');
    need(value.creators.every(plain)&&exact(value.creators.map(row=>({id:row.id,revision:row.revision})),p.creators.map(row=>({id:row.id,revision:row.revision}))),'The retained report selects different original creators.');
    const sum=(rows,key)=>rows.reduce((n,row)=>n+BigInt(row[key]),0n).toString();
    for(let i=0;i<p.creators.length;i++){
      const creator=p.creators[i],row=value.creators[i],earned=sum(p.accruals.filter(r=>r.creator_id===creator.id),'amount_minor'),paid=sum(p.payments.filter(r=>r.creator_id===creator.id),'amount_minor');
      need(row.name===creator.document.name&&row.stage===creator.document.stage,'The retained creator report identity differs.');
      const cash=cashStatement(p,creator.id),hasSettlement=(p.payment_returns||[]).length||(p.settlement_cases||[]).length;
      need(row.recorded_earned_minor===earned&&row.paid_minor===paid&&row.unpaid_earned_minor===(BigInt(earned)-BigInt(cash.net_paid_minor)).toString(),'The retained report changed the original recorded earning or completed net payment.');
      if(hasSettlement)need(plain(row.cash)&&exact(row.cash,cash),'The retained report changed the original complete creator cash statement.');
      const terms=creator.document.terms.filter(term=>term.state==='agreed');
      need(Array.isArray(row.terms)&&row.terms.length===terms.length,'Keep every original agreed compensation term in the report.');
      for(let j=0;j<terms.length;j++){
        const term=terms[j],retained=row.terms[j];
        need(plain(retained)&&retained.term_id===term.id,'The retained report selects another compensation term.');
        for(const key of ['basis','user_kind','unit_minor','cap_minor','agreement_source'])need(retained[key]===term[key],'The retained report changed its original agreed '+key+'.');
      }
    }
    const amounts={planned_service_fee_minor:p.document.service_fee_minor,planned_creator_budget_minor:p.document.creator_budget_minor,
      planned_other_budget_minor:p.document.other_budget_minor,creator_recorded_earned_minor:sum(p.accruals,'amount_minor'),
      creator_paid_minor:sum(p.payments,'amount_minor'),other_actual_cost_minor:sum(p.costs,'amount_minor')};
    if((p.payment_returns||[]).length||(p.settlement_cases||[]).length){
      const returned=sum(p.payment_returns||[],'amount_minor');
      Object.assign(amounts,{creator_returned_minor:returned,creator_net_paid_minor:(BigInt(amounts.creator_paid_minor)-BigInt(returned)).toString(),
        gross_total_spend_minor:(BigInt(amounts.creator_paid_minor)+BigInt(amounts.other_actual_cost_minor)).toString()});
      need(Array.isArray(value.settlement_cases)&&exact(value.settlement_cases,p.settlement_cases||[]),'The retained report changed the complete original settlement cases.');
    }
    for(const [key,expected] of Object.entries(amounts))need(value.economics[key]===expected,'The retained report changed the original recorded '+key+'.');
    return value;
  }
  function reviewDocument(bundle,currentReport){
    return {version:REPORT_REVIEW,bundle_sha256:bundle.sha256,programme_sha256:hash(bundle.programme),
      original_report:clone(bundle.report),current_report:clone(currentReport),report_matches:exact(bundle.report,currentReport)};
  }
  /** Read-only comparison. The original bundle and both complete reports remain separate. */
  function reviewBundle(bundle){
    need(plain(bundle)&&bundle.version===BUNDLE,'Receive a complete creator-programme handover.');
    const {sha256,...body}=bundle;need(sha256===hash(body),'The full received handover changed.');
    need(plain(bundle.programme)&&Array.isArray(bundle.operations),'Keep the complete original programme and operation history.');
    validate({creator_programmes:{version:VERSION,programmes:[clone(bundle.programme)],operations:clone(bundle.operations)}});
    need(bundle.operations.every(op=>op.result?.programme_id===bundle.programme.id),'Receive only operations belonging to the original selected programme.');
    reportSource(bundle.programme,bundle.report);
    const review=reviewDocument(bundle,report(bundle.programme));
    return {...review,sha256:hash(review)};
  }
  /** Reopening retains the calculation that was actually reviewed, across later engine editions. */
  function validateSavedReportReview(op){
    const bundle=op.input.bundle,choice=op.input.report_review,saved=op.result.report_review;
    need(plain(bundle)&&bundle.version===BUNDLE&&plain(bundle.programme)&&plain(choice)&&plain(saved),'Keep the complete original received report review.');
    const {sha256,...body}=bundle;need(sha256===hash(body),'The retained received programme handover changed.');
    reportSource(bundle.programme,bundle.report);reportSource(bundle.programme,saved.current_report);
    const review=reviewDocument(bundle,saved.current_report);
    need(saved.version===REPORT_REVIEW&&saved.review_sha256===hash(review)&&choice.sha256===saved.review_sha256&&
      saved.bundle_sha256===review.bundle_sha256&&saved.programme_sha256===review.programme_sha256&&
      saved.original_report_sha256===bundle.report.sha256&&saved.report_matches===review.report_matches&&
      op.result.programme_id===bundle.programme.id,'The saved report review lost its complete original selection.');
    text(choice.reason,'reason for receiving the retained report',8000,true);
    need(saved.reason===choice.reason,'Keep the original receiving reason.');
  }
  function reportHistory(root,key){
    return root.operations.filter(op=>op.kind==='programme-receive'&&op.result?.programme_id===key&&op.result.report_review).map(op=>{
      const saved=op.result.report_review;
      return {operation_id:op.id,received_at:op.at,reason:saved.reason,review_sha256:saved.review_sha256,
        bundle_sha256:saved.bundle_sha256,programme_sha256:saved.programme_sha256,
        original_report:clone(op.input.bundle.report),received_report:clone(saved.current_report)};
    });
  }
  function validateBundle(bundle){
    need(plain(bundle)&&bundle.version===BUNDLE,'Receive a complete creator-programme handover.');
    const {sha256,...body}=bundle;need(sha256===hash(body),'The full received handover changed.');
    need(Array.isArray(bundle.operations),'Keep the original complete operation history.');
    validate({creator_programmes:{version:VERSION,programmes:[clone(bundle.programme)],operations:clone(bundle.operations)}});
    const current=report(bundle.programme);need(exact(current,bundle.report),'The complete handover report differs from its source programme.');
    return bundle;
  }
  function exportProgramme(ledger,key){
    const root=validate(ledger),p=byId(root.programmes,key,'programme');
    const operations=root.operations.filter(o=>o.result.programme_id===key);
    const body={version:BUNDLE,programme:clone(p),operations:clone(operations),report:report(p)};
    return {...body,sha256:hash(body)};
  }
  function state(ledger,key=''){
    const root=validate(ledger),p=key?byId(root.programmes,key,'programme'):null;
    return {version:VERSION,root_sha256:hash(root),programmes:root.programmes.map(p=>({id:p.id,pack_id:p.pack_id,title:p.document.title,
      revision:p.revision,evidence_mode:p.document.evidence_mode,creators:p.creators.length,sources:p.sources.length})),
      selected:p?{programme:clone(p),report:report(p),report_history:reportHistory(root,p.id)}:null};
  }

  function forPack(ledger,packId){
    const root=validate(ledger),programmes=root.programmes.filter(p=>p.pack_id===packId);
    if(!programmes.length)return {};
    const ids=new Set(programmes.map(p=>p.id));
    return {creator_programmes:{version:VERSION,programmes:clone(programmes),
      operations:clone(root.operations.filter(o=>ids.has(o.result.programme_id)))},
      creator_programme_operations:clone((ledger.operations||[]).filter(o=>o.kind.startsWith('creator-')&&ids.has(o.result.programme_id)))};
  }
  function versions(row){return [...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,at:row.at}];}
  function extendsProgramme(later,earlier){
    if(later.id!==earlier.id||later.pack_id!==earlier.pack_id||!exact(later.source,earlier.source))return false;
    if(!commercialPayloads.extendsPayloads(later,earlier))return false;
    const a=versions(later),b=versions(earlier);
    if(a.length<b.length||b.some((v,i)=>!exact(v,a[i])))return false;
    for(const field of ['creators','sources','settlement_cases']){
      for(const old of earlier[field]||[]){
        const current=(later[field]||[]).find(r=>r.id===old.id);if(!current)return false;
        const av=versions(current),bv=versions(old);if(av.length<bv.length||bv.some((v,i)=>!exact(v,av[i])))return false;
      }
    }
    for(const field of ['decisions','accruals','payments','costs','term_changes','payment_returns']){
      if((earlier[field]||[]).some((r,i)=>!(later[field]||[])[i]||!exact(r,later[field][i])))return false;
    }
    return true;
  }
  /** Import only a complete descendant; retain divergent work for explicit source reconciliation. */
  function merge(ledger,bundle,receiving){
    if(bundle.creator_programmes===undefined)return;
    const incoming=validate({creator_programmes:bundle.creator_programmes}),current=validate(ledger);
    const field='creator_programmes',ids=new Set(incoming.programmes.map(p=>p.id));
    const conflict=(id,reason)=>receiving.conflicts.push({entity:field,id,reason});
    const grouped=new Map([...ids].map(key=>[key,{inner:[],outer:[]}]));
    for(const op of incoming.operations){
      const group=grouped.get(op.result?.programme_id);
      if(!group){conflict(op.id,'A programme operation has lost its selected customer.');continue;}
      group.inner.push(op);
    }
    const outer=bundle.creator_programme_operations||[];
    need(Array.isArray(outer),'Retain the original creator request results.');
    const incomingOuter=new Map(),blocked=new Set();
    for(const op of outer){
      id(op.id);need(typeof op.kind==='string'&&op.kind.startsWith('creator-')&&ids.has(op.result?.programme_id)&&
        /^[a-f0-9]{64}$/.test(op.request_sha256)&&op.result.pack_id===bundle.pack.id,'The original creator request result is incomplete.');
      instant(op.occurred_at,'original creator save time');
      const previous=incomingOuter.get(op.id);
      if(previous&&!exact(previous,op)){
        blocked.add(previous.result.programme_id);blocked.add(op.result.programme_id);
        conflict(op.id,'The received original save operation ID has different inputs or results.');
      }else if(!previous)incomingOuter.set(op.id,op);
    }
    for(const op of incomingOuter.values())grouped.get(op.result.programme_id).outer.push(op);
    const innerById=new Map(current.operations.map(op=>[op.id,op]));
    const outerOperations=clone(ledger.operations||[]),outerById=new Map(outerOperations.map(op=>[op.id,op]));
    const changes={added:0,advanced:0,unchanged:0,kept_current:0,records:[]};
    let outerAdded=false;
    for(const p of incoming.programmes){
      if(p.pack_id!==bundle.pack.id){conflict(p.id,'The programme belongs to another original customer.');continue;}
      if(blocked.has(p.id))continue;
      const old=current.programmes.find(r=>r.id===p.id);
      let action;
      if(!old)action='add';
      else if(exact(old,p))action='unchanged';
      else if(extendsProgramme(p,old))action='advance';
      else if(extendsProgramme(old,p))action='keep_current';
      else{conflict(p.id,'Both programme copies contain different work; retain both full sources and reconcile through the original programme.');continue;}
      const group=grouped.get(p.id);let compatible=true;
      for(const op of group.inner){
        const existing=innerById.get(op.id);
        if(existing&&!exact(existing,op)){
          compatible=false;conflict(op.id,'The same programme operation ID has different original inputs or results.');
        }
      }
      for(const op of group.outer){
        const existing=outerById.get(op.id);
        if(existing&&!exact(existing,op)){
          compatible=false;conflict(op.id,'The same original save operation contains different work.');
        }
      }
      if(!compatible)continue;
      // Financial rows retain exactly one original request. Even identical
      // programme bodies cannot adopt another request for the same earning.
      const selected=action==='add'||action==='advance'?p:old;
      const candidateOperations=current.operations.concat(group.inner.filter(op=>!innerById.has(op.id)));
      try{
        validate({creator_programmes:{version:VERSION,programmes:[clone(selected)],
          operations:candidateOperations.filter(op=>op.result.programme_id===p.id)}});
      }catch(error){
        if(error.code!=='CREATOR_PROGRAMME')throw error;
        conflict(p.id,'The complete received programme and original operation histories cannot be joined: '+error.message);
        continue;
      }
      // The complete programme and both original operation layers are one receiving decision.
      if(action==='add'){current.programmes.push(clone(p));changes.added++;}
      else if(action==='advance'){current.programmes[current.programmes.indexOf(old)]=clone(p);changes.advanced++;}
      else if(action==='unchanged')changes.unchanged++;else changes.kept_current++;
      for(const op of group.inner)if(!innerById.has(op.id)){
        const saved=clone(op);current.operations.push(saved);innerById.set(op.id,saved);changes.added++;
      }
      for(const op of group.outer)if(!outerById.has(op.id)){
        const saved=clone(op);outerOperations.push(saved);outerById.set(op.id,saved);changes.added++;outerAdded=true;
      }
      changes.records.push({entity:field,id:p.id,name:p.document.title,action});
    }
    // Validate the complete staged receiving before committing either operation layer.
    const checked=validate({creator_programmes:current});
    ledger.creator_programmes=checked;
    if(outerAdded)ledger.operations=outerOperations;
    receiving.added[field]=(receiving.added[field]||0)+changes.added;
    receiving.advanced[field]=(receiving.advanced[field]||0)+changes.advanced;
    receiving.unchanged+=changes.unchanged;
    receiving.kept_current+=changes.kept_current;
    receiving.records.push(...changes.records);
  }
  function view(ledger,packId){
    const selected=forPack(ledger,packId).creator_programmes||empty();
    return {version:VERSION,programmes:selected.programmes.map(p=>({programme:clone(p),report:report(p),report_history:reportHistory(selected,p.id)}))};
  }

  return Object.freeze({VERSION,BUNDLE,REPORT_REVIEW,reviewBundle,hash,empty,validate,apply,state,report,exportProgramme,validateBundle,parseSource,forPack,merge,view,sourceSelection});
}
module.exports={createCreatorProgrammeEngine,createCreatorCommercialPayloads};
