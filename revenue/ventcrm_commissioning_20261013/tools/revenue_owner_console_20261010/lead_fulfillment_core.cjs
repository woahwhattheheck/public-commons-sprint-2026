'use strict';
/** Lead briefs, original request editions, customer packs and replacement fulfillment. */
const {sha256Utf8,sha256Bytes,utf8ByteLength}=require('../../host/connected_sha256.cjs');
const VERSION='dealscout.lead-fulfillment.v1';
const BUNDLE='dealscout.lead-working-record.v1';
const RECONCILIATION_BUNDLE='dealscout.lead-working-record.v3';
const WORKSPACE_BUNDLE='dealscout.lead-workspace-record.v1';
const EDITION='dealscout.lead-pack.v1';
const capture=require('./lead_capture_core.cjs');
const customerFiles=require('./lead_customer_files.cjs').createLeadCustomerFiles({hash,sha256Bytes,utf8ByteLength});
const reconciliation=require('./lead_reconciliation_core.cjs');
const customerRequests=require('./lead_customer_requests.cjs').createLeadCustomerRequests({hash,sha256Utf8,utf8ByteLength});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// One synchronous operation often sees the same immutable document in the live
// record, normalized form and prepared editions. Cache exact serialized values
// only within that call; later calls still validate edits to their input.
let operationHashes=null;
const HASH_CACHE_CHARACTERS=4*1024*1024;
const HASH_CACHE_ENTRIES=4096;
const HASH_CACHE_VALUE_CHARACTERS=65536;
function hash(value){
  const serialized=JSON.stringify(canonical(value)),cache=operationHashes;
  const saved=cache?.values.get(serialized);
  if(saved!==undefined)return saved;
  const digest=sha256Utf8(serialized).sha256;
  if(cache&&serialized.length<=HASH_CACHE_VALUE_CHARACTERS&&cache.values.size<HASH_CACHE_ENTRIES&&
    cache.characters+serialized.length<=HASH_CACHE_CHARACTERS){
    cache.values.set(serialized,digest);cache.characters+=serialized.length;
  }
  return digest;
}
function withOperationHashes(operation){
  const wrapped=function(...args){
    const previous=operationHashes;
    operationHashes={values:new Map(),characters:0};
    try{return operation(...args);}
    finally{operationHashes=previous;}
  };
  return Object.defineProperties(wrapped,{name:{value:operation.name},length:{value:operation.length}});
}
const issue=(status,message,details)=>Object.assign(new Error(message),{status,code:'LEAD_FULFILLMENT',...(details?{details}:{})});
const need=(value,message,status=422,details)=>{if(!value)throw issue(status,message,details);};
function text(value,label,max=8000,required=false){
  need(typeof(value??'')==='string',label+' must be text.');
  const result=(value??'').trim();
  need(result.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),label+' contains unsupported text.');
  need(!required||result,'Enter '+label+'.');utf8ByteLength(result);return result;
}
function id(value,label='record ID'){
  const result=text(value,label,160,true);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result),'Use letters, numbers, dots, colons or hyphens for '+label+'.');return result;
}
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,label+' is outside its supported range.');return value;
}
function date(value,label,required=false){
  const result=text(value,label,10,required);if(!result)return '';
  need(/^\d{4}-\d\d-\d\d$/.test(result)&&Number.isFinite(Date.parse(result+'T12:00:00Z'))&&new Date(result+'T12:00:00Z').toISOString().slice(0,10)===result,
    label+' needs a valid YYYY-MM-DD date.');return result;
}
function instant(value,label,required=false){
  const result=text(value,label,40,required);if(!result)return '';
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(result)&&Number.isFinite(Date.parse(result)),
    label+' needs a date, time and timezone.');date(result.slice(0,10),label);return new Date(result).toISOString();
}
function choice(value,values,label){need(values.includes(value),'Choose '+label+'.');return value;}
function web(value,label='source URL',required=false,mail=false){
  const result=text(value,label,4000,required);if(!result)return '';
  if(mail&&/^mailto:[^@\s<>?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(result))return result;
  if(mail&&/^tel:\+[1-9]\d{1,14}(?:;ext=\d{1,10})?$/i.test(result))return result.toLowerCase();
  const parsed=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(result);
  need(parsed&&!parsed[2].includes('..')&&(!parsed[3]||Number(parsed[3])<=65535),label+(mail?' needs an HTTP(S), mailto:, or international tel:+number address.':' needs an absolute HTTP or HTTPS address.'));return result;
}
function domain(value){
  const result=text(value,'company domain',253).toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  need(!result||/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(result)&&!result.includes('..'),'Enter the company domain without a path.');return result;
}
function list(value,label){need(Array.isArray(value??[]),label+' must be a list.');return [...new Set((value??[]).map(v=>text(v,label,1000,true)))];}
function canonicalURL(value){
  if(!value)return '';
  if(/^(?:mailto|tel):/i.test(value))return value.toLowerCase();
  const m=/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value);
  if(!m)return value;
  let authority=m[2].toLowerCase().replace(/^www\./,'');
  authority=authority.replace(m[1].toLowerCase()==='https'?/:443$/:/:80$/,'');
  let path=m[3].replace(/\/+$/,'')||'/';
  // Discourse activity/reply URLs identify the same original buyer request.
  const topic=/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?$/.exec(path);
  if(topic)path='/t/'+topic[1];
  const query=(m[4]||'').split('&').filter(Boolean).filter(part=>! /^(?:utm_[^=]*|fbclid|gclid)=/i.test(part)).sort().join('&');
  // GitHub issue comments are separate public requests on a shared thread.
  // Keep only the platform's exact comment anchor; ordinary page anchors remain
  // presentation details and cannot create additional lead identities.
  const comment=authority==='github.com'&&/^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*$/.test(path)&&
    /^issuecomment-[1-9]\d*$/.test(m[5]||'')?'#'+m[5]:'';
  return 'https://'+authority+path+(query?'?'+query:'')+comment;
}
function sourceExcluded(source,excluded){
  const request=canonicalURL(source),thread=request.replace(/#issuecomment-[1-9]\d*$/,'');
  // A retained thread-level exclusion still covers all its comments. A newly
  // selected exact comment can be excluded without excluding other authors.
  return excluded.includes(request)||excluded.includes(thread);
}
function keys(lead){
  const result=['request:'+canonicalURL(lead.source_url)];
  if(!lead.source_url)result.length=0;
  if(lead.company_domain)result.push('company:'+lead.company_domain);
  if(lead.buyer_key)result.push('buyer:'+lead.buyer_key.toLowerCase());
  if(/^mailto:/i.test(lead.contact_url))result.push('email:'+lead.contact_url.slice(7).toLowerCase());
  return result;
}
const intersects=(left,right)=>left.some(value=>right.includes(value));
function normalizePack(input){
  need(plain(input),'Enter the customer brief.');const c=input.customer??{},b=input.brief??{};
  need(plain(c)&&plain(b),'Enter a customer and brief.');
  const currency=text(b.currency??'USD','currency',3,true).toUpperCase();
  need(/^[A-Z]{3}$/.test(currency),'Use a three-letter currency.');
  return {customer:{name:text(c.name,'customer name',240,true),company_domain:domain(c.company_domain),
    contact_url:web(c.contact_url,'customer contact',false,true),case_id:text(c.case_id,'existing case ID',160),
    prospect_id:text(c.prospect_id,'existing prospect ID',160)},
    brief:{title:text(b.title,'pack title',300,true),description:text(b.description,'customer criteria',8000,true),
      geography:text(b.geography,'geography',1000),skills:list(b.skills,'skills'),
      lead_kind:choice(b.lead_kind??'any',['any','paid_request','problem_signal','company_fit'],'the requested lead type'),
      quantity:integer(b.quantity??5,'paid pack quantity',1,500),currency,
      price_minor:integer(b.price_minor??2000,'price in minor currency units'),
      max_age_days:integer(b.max_age_days??0,'original request age limit',0,3660),
      excluded_domains:list(b.excluded_domains,'excluded domains').map(domain),
      excluded_sources:list(b.excluded_sources,'excluded request URLs').map(value=>canonicalURL(web(value))),
      exclusions:text(b.exclusions,'other customer exclusions',8000)},
    operator_note:text(input.operator_note,'internal note',12000)};
}
/** Source labels are observations, never inferred publication dates or deadlines. */
function sourceTimeObservation(value,lead){
  need(plain(value)&&Object.keys(value).every(key=>['source_url','checked_at','closing_label','publication_label'].includes(key)),
    'Keep the complete source-time observation with its source, check time and original labels.');
  const checked=/^\d{4}-\d\d-\d\d$/.test(value.checked_at??'')?
    date(value.checked_at,'source-time observation check date',true):instant(value.checked_at,'source-time observation check time',true);
  const observation={source_url:web(value.source_url,'source-time observation URL',true),checked_at:checked,
    closing_label:text(value.closing_label,'original closing label',1000,true),
    ...(Object.hasOwn(value,'publication_label')?{publication_label:text(value.publication_label,'original publication label',1000)}:{})};
  need(observation.source_url===lead.source_url&&observation.checked_at===lead.checked_at,
    'Recheck the original closing label and bind it to this record’s exact source URL and source-check time.');
  return observation;
}
function observedRemainingDays(lead){
  const observation=lead.source_time_observation;
  if(!plain(observation)||observation.source_url!==lead.source_url||observation.checked_at!==lead.checked_at)return null;
  // Preserve unsupported labels, but only this positive whole-day source wording
  // qualifies an undated open request. It does not establish a calendar deadline.
  const match=/^Ends in ([1-9]\d{0,5}) days?\.?$/i.exec(observation.closing_label??'');
  return match?Number(match[1]):null;
}
function normalizeLead(input){
  need(plain(input),'Enter a complete lead record.');
  const lead={organization:text(input.organization,'company or buyer name',400),
    company_domain:domain(input.company_domain),company_url:web(input.company_url,'company URL'),
    buyer_key:text(input.buyer_key,'original buyer identity',600),person:text(input.person,'contact name',240),
    source_url:web(input.source_url),published_on:date(input.published_on,'original request date'),
    author_updated_on:date(input.author_updated_on,'last buyer update date'),
    lead_kind:choice(input.lead_kind??'problem_signal',['paid_request','problem_signal','company_fit'],'the kind of buyer signal'),
    checked_at:/^\d{4}-\d\d-\d\d$/.test(input.checked_at??'')?date(input.checked_at,'source checked date'):instant(input.checked_at,'source checked time'),deadline_on:date(input.deadline_on,'deadline date'),
    deadline_at:instant(input.deadline_at,'exact deadline'),
    demand:text(input.demand,'buyer request',8000),fit:text(input.fit,'reason this matches the brief',8000),
    contact_url:web(input.contact_url,'public contact route',false,true),contact_instructions:text(input.contact_instructions,'contact instructions',8000),
    geography:text(input.geography,'lead geography',1000),budget:text(input.budget,'published budget',1000),
    opening_message:text(input.opening_message,'suggested opening message',12000),
    source_status:choice(input.source_status??'unconfirmed',['open','unconfirmed','closed','expired','excluded'],'the source status'),
    status_note:text(input.status_note,'source status note',8000),
    tags:list(input.tags,'lead tags'),operator_note:text(input.operator_note,'internal lead note',12000)};
  // Omitted observations leave every existing normalized record/hash unchanged.
  if(Object.hasOwn(input,'source_time_observation'))lead.source_time_observation=sourceTimeObservation(input.source_time_observation,lead);
  return lead;
}
function empty(){return {version:VERSION,packs:[],leads:[],editions:[],deliveries:[],withdrawals:[],operations:[]};}
function find(rows,value,label){const result=rows.find(row=>row.id===value);need(result,'Choose an existing '+label+'.',404);return result;}
function validRecord(row,normalize){
  need(plain(row)&&Number.isSafeInteger(row.revision)&&row.revision>0&&plain(row.document)&&Array.isArray(row.history),
    'The saved lead record is incomplete.');
  id(row.id);instant(row.updated_at,'saved record time',true);
  need(row.sha256===hash(row.document)&&row.history.length===row.revision-1,'The saved lead edition changed.');
  if(normalize)need(hash(normalize(row.document))===row.sha256,'The saved record does not contain its complete supported fields.');
  row.history.forEach((old,i)=>{
    need(plain(old)&&plain(old.document)&&old.revision===i+1&&old.sha256===hash(old.document),'The saved lead history changed.');
    instant(old.updated_at,'saved history time',true);
    if(normalize)need(hash(normalize(old.document))===old.sha256,'The saved history is incomplete.');
  });
}
const FEEDBACK='dealscout.lead-delivery-feedback.v1';
const FEEDBACK_SOURCE='dealscout.lead-delivery-feedback-source.v1';
const FOLLOWUP='dealscout.lead-delivery-followup.v1';
const digestValue=(value,label)=>need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),label+' is missing or changed.');
const feedbackRows=root=>root.delivery_feedback||[];
const feedbackSources=root=>root.delivery_feedback_sources||[];

function validateDeliveryFeedback(root){
  for(const key of ['delivery_feedback','delivery_feedback_sources','delivery_followups']){
    need(root[key]===undefined||Array.isArray(root[key]),'The saved delivery feedback is incomplete.');
    const rows=root[key]||[];
    need(new Set(rows.map(row=>row?.id)).size===rows.length,'The saved delivery feedback repeats an ID.');
    for(const row of rows){
      need(plain(row),'The saved delivery feedback record is incomplete.');id(row.id);
      const {sha256,...document}=row;
      need(sha256===hash(document),'A saved delivery feedback record changed.');
    }
  }
  const sources=new Map(feedbackSources(root).map(row=>[row.id,row]));
  for(const source of sources.values()){
    need(source.version===FEEDBACK_SOURCE,'Use a complete native delivery feedback source.');
    choice(source.kind,['report','sent'],'native source kind');
    text(source.mailbox,'source mailbox',320,true);text(source.provider_id,'source provider ID',500,true);
    text(source.thread_id,'source thread ID',500);instant(source.occurred_at,'source occurrence time',true);
    choice(source.origin,['GMAIL_FULL','RETAINED_NATIVE_SENT'],'native source origin');
    if(source.origin==='GMAIL_FULL')need(plain(source.native_message)&&source.saved_sent===null,'The complete native message is missing.');
    else{
      need(source.kind==='sent'&&source.native_message===null&&plain(source.saved_sent)&&plain(source.saved_sent.event),
        'The complete retained native sent event is missing.');
      id(source.saved_sent.case_id,'original sent case ID');
    }
    digestValue(source.native_identity_sha256,'The native message identity');
  }
  const deliveries=new Map(root.deliveries.map(row=>[row.id,row]));
  for(const row of feedbackRows(root)){
    need(row.version===FEEDBACK,'Use a complete delivery feedback record.');
    const delivery=deliveries.get(row.delivery_id),edition=root.editions.find(value=>value.id===row.edition_id);
    need(delivery&&edition&&delivery.edition_id===edition.id&&edition.pack_id===row.pack_id,
      'The delivery feedback lost its original customer edition.');
    need(hash(delivery)===row.delivery_sha256&&edition.sha256===row.edition_sha256,
      'The delivery feedback differs from its original delivery or edition.');
    const report=sources.get(row.report_source_id),sent=sources.get(row.sent_source_id);
    need(report?.kind==='report'&&sent?.kind==='sent','The delivery feedback lost its complete original report or sent message.');
    need(report.mailbox===row.mailbox&&sent.mailbox===row.mailbox&&report.provider_id===row.notice_provider_id&&
      sent.provider_id===row.sent_provider_id&&delivery.provider_id===row.sent_provider_id,
      'The native feedback belongs to another mailbox or provider delivery.');
    digestValue(row.report_source_sha256,'The original delivery report identity');
    digestValue(row.sent_source_sha256,'The original sent message identity');
    digestValue(row.sent_native_review_sha256,'The original native sent review identity');
    id(row.report_id,'original report ID');id(row.recipient_id,'original report recipient ID');
    text(row.recipient,'actual report recipient',1000,true);text(row.recipient_match,'matched recipient field',120,true);
    text(row.header_field,'original sent recipient header',120,true);
    choice(row.action,['failed','delayed','delivered','relayed','expanded'],'delivery report action');
    text(row.state,'delivery report state',120,true);text(row.status,'native delivery status',120,true);
    need(typeof row.terminal==='boolean','The native delivery report terminal state is missing.');
    need(row.diagnostic===null||plain(row.diagnostic),'The original delivery diagnostic is incomplete.');
    if(row.diagnostic)for(const key of ['raw','type','value'])text(row.diagnostic[key],'delivery diagnostic '+key,16000);
    instant(row.occurred_at,'delivery report occurrence time',true);
    instant(row.last_attempt_at,'delivery report last attempt time');
    instant(row.will_retry_until,'delivery report retry time');
    need(Array.isArray(row.original_message_ids)&&row.original_message_ids.every(value=>typeof value==='string'&&value.length<=1000),
      'The original message references are incomplete.');
    text(row.original_envelope_id,'original envelope ID',2000);
    need(Array.isArray(row.case_bindings)&&row.case_bindings.every(plain),'The original case bindings are incomplete.');
  }
  const parents=new Map();
  const link=(previousId,deliveryId,previousSha,deliverySha)=>{
    const previous=deliveries.get(previousId),delivery=deliveries.get(deliveryId);
    need(previous&&delivery&&previous.id!==delivery.id&&previous.edition_id===delivery.edition_id&&
      hash(previous)===previousSha&&(!deliverySha||hash(delivery)===deliverySha),
      'The follow-up lost its original prepared edition or one of its recorded deliveries.');
    need(Date.parse(delivery.delivered_at)>=Date.parse(previous.delivered_at),
      'The follow-up delivery precedes its earlier attempt.');
    need(!parents.has(deliveryId),'This recorded delivery already follows an earlier attempt.');
    parents.set(deliveryId,previousId);
  };
  for(const delivery of root.deliveries){
    if(!delivery.previous_delivery_id){
      need(!delivery.previous_delivery_sha256,'The earlier delivery reference is incomplete.');continue;
    }
    id(delivery.previous_delivery_id,'earlier delivery ID');
    link(delivery.previous_delivery_id,delivery.id,delivery.previous_delivery_sha256);
  }
  for(const row of root.delivery_followups||[]){
    need(row.version===FOLLOWUP,'Use the complete recorded-delivery association.');
    id(row.previous_delivery_id,'earlier delivery ID');id(row.delivery_id,'follow-up delivery ID');
    const edition=root.editions.find(value=>value.id===row.edition_id);
    need(edition&&edition.pack_id===row.pack_id&&edition.sha256===row.edition_sha256&&
      deliveries.get(row.delivery_id)?.edition_id===edition.id,
      'The recorded-delivery association lost its original customer edition.');
    digestValue(row.previous_delivery_sha256,'The original earlier delivery');
    digestValue(row.delivery_sha256,'The original follow-up delivery');
    instant(row.recorded_at,'association time',true);text(row.note,'association note',4000,true);
    need(row.source_ids===undefined||Array.isArray(row.source_ids),'Keep the complete original source references for this association.');
    const sourceIds=row.source_ids||[];
    need(new Set(sourceIds).size===sourceIds.length,'The delivery association repeats an original source.');
    for(const sourceId of sourceIds){
      id(sourceId,'original sent source ID');
      const source=sources.get(sourceId);
      need(source?.kind==='sent'&&[row.previous_delivery_id,row.delivery_id].some(deliveryId=>{
        const delivery=deliveries.get(deliveryId);
        return delivery&&delivery.provider_id===source.provider_id&&Date.parse(delivery.delivered_at)===Date.parse(source.occurred_at);
      }),'The delivery association lost an original sent source or its actual provider time.');
    }
    link(row.previous_delivery_id,row.delivery_id,row.previous_delivery_sha256,row.delivery_sha256);
    need(Date.parse(row.recorded_at)>=Date.parse(deliveries.get(row.delivery_id).delivered_at),
      'The association precedes the recorded follow-up delivery.');
  }
  // Each send has at most one parent. Visit each retained edge once, including
  // older inline links, so complete programme histories remain cheap to reopen.
  const finished=new Set();
  for(const deliveryId of parents.keys()){
    const path=new Set();let current=deliveryId;
    while(current&&!finished.has(current)){
      need(!path.has(current),'The delivery follow-up history contains a cycle.');
      path.add(current);current=parents.get(current);
    }
    for(const id of path)finished.add(id);
  }
}

function deliveryParent(root,deliveryId){
  return root.deliveries.find(row=>row.id===deliveryId)?.previous_delivery_id||
    (root.delivery_followups||[]).find(row=>row.delivery_id===deliveryId)?.previous_delivery_id||'';
}

function deliveryFeedbackState(root,deliveryId){
  const rows=feedbackRows(root).filter(row=>row.delivery_id===deliveryId).slice().sort((a,b)=>
    Date.parse(a.last_attempt_at||a.occurred_at)-Date.parse(b.last_attempt_at||b.occurred_at)||
    Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||a.id.localeCompare(b.id));
  const latest=rows.at(-1)||null,followups=root.deliveries.filter(row=>row.previous_delivery_id===deliveryId).map(row=>row.id);
  followups.push(...(root.delivery_followups||[]).filter(row=>row.previous_delivery_id===deliveryId).map(row=>row.delivery_id));
  return {delivery_id:deliveryId,action:latest?.action||'',state:latest?.state||'RECORDED',
    latest_feedback_id:latest?.id||'',feedback_count:rows.length,followup_delivery_ids:followups,
    previous_delivery_id:deliveryParent(root,deliveryId),
    needs_attention:!followups.length&&['failed','delayed'].includes(latest?.action)};
}

function feedbackForPack(root,packId){
  const feedback=feedbackRows(root).filter(row=>row.pack_id===packId);
  const identities=new Set(feedback.flatMap(row=>[
    JSON.stringify([row.mailbox,'report',row.notice_provider_id]),JSON.stringify([row.mailbox,'sent',row.sent_provider_id])]));
  const links=(root.delivery_followups||[]).filter(row=>row.pack_id===packId);
  const linkedSources=new Set(links.flatMap(row=>row.source_ids||[]));
  const linkedDeliveryIds=new Set(links.flatMap(row=>[row.previous_delivery_id,row.delivery_id]));
  const editions=new Set(root.editions.filter(row=>row.pack_id===packId).map(row=>row.id));
  for(const delivery of root.deliveries)if(editions.has(delivery.edition_id)){
    linkedDeliveryIds.add(delivery.id);
    if(delivery.previous_delivery_id)linkedDeliveryIds.add(delivery.previous_delivery_id);
  }
  const linkedSends=new Set(root.deliveries.filter(row=>linkedDeliveryIds.has(row.id))
    .map(row=>JSON.stringify([row.provider_id,Date.parse(row.delivered_at)])));
  return {delivery_feedback:clone(feedback),delivery_feedback_sources:clone(feedbackSources(root).filter(source=>
    linkedSources.has(source.id)||identities.has(JSON.stringify([source.mailbox,source.kind,source.provider_id]))||
    source.kind==='sent'&&linkedSends.has(JSON.stringify([source.provider_id,Date.parse(source.occurred_at)]))))};
}

function compatibleDeliveryFeedback(root,current,incoming){
  const meaning=row=>{
    const {sha256,report_source_id,sent_source_id,sent_source_sha256,...document}=row;return document;
  };
  if(hash(meaning(current))!==hash(meaning(incoming)))return false;
  const sources=new Map(feedbackSources(root).map(row=>[row.id,row]));
  const reports=[sources.get(current.report_source_id),sources.get(incoming.report_source_id)];
  const sent=[sources.get(current.sent_source_id),sources.get(incoming.sent_source_id)];
  if([...reports,...sent].some(row=>!row))return false;
  if(reports[0].native_identity_sha256!==reports[1].native_identity_sha256)return false;
  if(sent.every(row=>row.origin==='GMAIL_FULL')&&sent[0].native_identity_sha256!==sent[1].native_identity_sha256)return false;
  return current.sent_native_review_sha256===incoming.sent_native_review_sha256;
}

function appendDeliveryFeedback(root,preview,at){
  need(plain(preview)&&preview.version==='dealscout.lead-delivery-feedback-preview.v1'&&
    Array.isArray(preview.feedback)&&Array.isArray(preview.sources),'Review the complete native delivery report first.');
  need(preview.feedback.length,'Receive the original prepared edition and its sent delivery, then review this report again.');
  const added={feedback:0,sources:0};
  for(const [key,incoming,counter]of [
    ['delivery_feedback_sources',preview.sources,'sources'],['delivery_feedback',preview.feedback,'feedback']]){
    if(!root[key])root[key]=[];
    const saved=new Map(root[key].map(row=>[row.id,row]));
    for(const row of incoming){
      const previous=saved.get(row.id);
      if(previous)need(hash(previous)===hash(row),'The same native feedback ID contains different original work.',409);
      else{root[key].push(clone(row));saved.set(row.id,row);added[counter]++;}
    }
  }
  validateDeliveryFeedback(root);
  const packIds=[...new Set(preview.feedback.map(row=>row.pack_id))];
  return {pack_id:preview.pack_id|| (packIds.length===1?packIds[0]:''),pack_ids:packIds,
    feedback_ids:preview.feedback.map(row=>row.id),source_ids:preview.sources.map(row=>row.id),
    feedback_added:added.feedback,sources_added:added.sources,received:true};
}

function validateRoot(ledger){
  need(plain(ledger),'Open the original sales workspace.');
  const root=ledger.lead_fulfillment;if(root===undefined)return empty();
  need(plain(root)&&root.version===VERSION,'Open a compatible lead fulfillment workspace.');
  for(const key of ['packs','leads','editions','deliveries','withdrawals','operations']){
    need(Array.isArray(root[key]),'The saved '+key+' list is missing.');
    root[key].forEach(row=>{need(plain(row),'The saved '+key+' record is incomplete.');id(row.id);});
    need(new Set(root[key].map(row=>row.id)).size===root[key].length,'The saved '+key+' list contains repeated IDs.');
  }
  root.packs.forEach(row=>validRecord(row,normalizePack));root.leads.forEach(row=>validRecord(row,normalizeLead));
  const packIds=new Set(root.packs.map(row=>row.id));
  for(const row of root.leads)need(packIds.has(row.pack_id),'A lead has lost its original customer brief.');
  for(const row of root.editions){
    const {sha256,...document}=row;
    need(row.version===EDITION&&sha256===hash(document)&&packIds.has(row.pack_id)&&Array.isArray(row.leads),'The complete prepared customer edition changed.');
    need(hash(normalizePack(row.brief))===hash(row.brief),'The prepared customer brief is incomplete.');
    choice(row.kind,['sample','paid','replacement'],'the saved delivery type');instant(row.prepared_at,'prepared edition time',true);
    need(row.leads.length===(row.kind==='sample'?1:row.brief.brief.quantity)&&new Set(row.leads.map(lead=>lead.id)).size===row.leads.length,'The prepared edition has an incomplete lead selection.');
    need(row.currency===row.brief.brief.currency&&row.price_minor===(row.kind==='paid'?row.brief.brief.price_minor:0),'The prepared edition price differs from its original brief.');
    row.leads.forEach(lead=>{validRecord(lead,normalizeLead);need(lead.pack_id===row.pack_id,'A prepared lead belongs to another pack.');});
  }
  for(const row of [...root.deliveries,...root.withdrawals])need(root.editions.some(edition=>edition.id===row.edition_id),'An edition event has lost its original customer edition.');
  capture.validateCaptureState(root);
  validateDeliveryFeedback(root);
  customerRequests.validate(root);
  customerFiles.validate(root);
  for(const key of ['commercial_links','commercial_deliveries']){
    need(root[key]===undefined||Array.isArray(root[key]),'The saved commercial associations are incomplete.');
    const rows=root[key]||[];
    need(new Set(rows.map(row=>row.id)).size===rows.length,'The saved commercial associations repeat an ID.');
    for(const row of rows){
      need(plain(row),'The saved commercial association is incomplete.');id(row.id);
      const {sha256,...document}=row;need(sha256===hash(document),'The saved commercial association changed.');
      const edition=root.editions.find(value=>value.id===row.edition_id);
      need(edition&&edition.pack_id===row.pack_id&&edition.sha256===row.edition_sha256,'The commercial association lost its original customer edition.');
      id(row.case_id,'original case ID');
      if(key==='commercial_links'){
        need(edition.kind==='paid','A commercial scope belongs to the original paid edition.');
        id(row.scope_id,'original scope ID');need(/^[a-f0-9]{64}$/.test(row.scope_sha256),'The original scope identity is missing.');
        instant(row.linked_at,'commercial link time',true);text(row.reason,'scope link reason',4000);
        if(row.previous_id)need((root.commercial_links||[]).some(old=>old.id===row.previous_id&&old.edition_id===row.edition_id),'The earlier commercial scope link is missing.');
      }else{
        const delivery=root.deliveries.find(value=>value.id===row.delivery_id);
        need(delivery&&delivery.edition_id===edition.id&&hash(delivery)===row.source_sha256,'The commercial delivery lost its original provider source.');
        need((root.commercial_links||[]).some(link=>link.id===row.link_id&&link.case_id===row.case_id),'The commercial delivery lost its original case link.');
        id(row.record_id,'original case delivery ID');need(/^[a-f0-9]{64}$/.test(row.record_sha256),'The case delivery identity is missing.');
        instant(row.recorded_at,'commercial delivery recording time',true);
      }
    }
  }
  reconciliation.validate(root,reconciliationAPI());
  return root;
}
function revision(rows,recordId,document,at,extra={}){
  const old=rows.find(row=>row.id===recordId);
  if(old&&hash(old.document)===hash(document))return old;
  const next={id:recordId,...extra,revision:(old?.revision??0)+1,document,sha256:hash(document),updated_at:at,
    history:old?[...old.history,{revision:old.revision,document:old.document,sha256:old.sha256,updated_at:old.updated_at}]:[]};
  if(old)rows[rows.indexOf(old)]=next;else rows.push(next);return next;
}
function customerKeys(customer){return [customer.case_id?'case:'+customer.case_id:'',customer.prospect_id?'prospect:'+customer.prospect_id:'',
  customer.company_domain?'domain:'+customer.company_domain:'',customer.contact_url?'contact:'+canonicalURL(customer.contact_url):'',
  'name:'+customer.name.toLowerCase()].filter(Boolean);}
const withdrawn=(root,editionId)=>root.withdrawals.some(row=>row.edition_id===editionId);
function quality(lead,pack,at){
  const reasons=[],notes=[],d=lead.document??lead,b=pack.document?.brief??pack.brief;
  if(!d.organization)reasons.push('Add the company or original buyer name.');
  if(!d.source_url)reasons.push(d.lead_kind==='company_fit'?'Add the original company source.':'Add the original buyer request.');
  const today=at.slice(0,10);
  const futureDeadline=d.deadline_at?Date.parse(d.deadline_at)>Date.parse(at):Boolean(d.deadline_on&&d.deadline_on>today);
  const remainingDays=observedRemainingDays(d);
  const currentUndatedRequest=d.lead_kind==='paid_request'&&d.source_status==='open'&&
    Boolean(d.checked_at&&d.checked_at.slice(0,10)===today)&&(futureDeadline||remainingDays!==null)&&!b.max_age_days;
  if(d.lead_kind!=='company_fit'&&!d.published_on){
    if(currentUndatedRequest)notes.push(futureDeadline?
      'Issue date is unavailable; open status and a future closing date were checked today.':
      'Issue date is unavailable; the open source was checked today and displayed “'+d.source_time_observation.closing_label+'”. The original relative label is retained.');
    else reasons.push(b.max_age_days?'Record the original request date to apply the customer age limit.':
      'Record the original request date, or recheck an open paid request with a future published deadline or a supported positive remaining-days closing label today.');
  }
  if(!d.checked_at)reasons.push('Record when the source was checked.');
  if(!d.demand)reasons.push(d.lead_kind==='company_fit'?'Describe the observed business need or workflow.':'Describe the buyer request.');
  if(b.lead_kind!=='any'&&d.lead_kind!==b.lead_kind)reasons.push('This buyer signal does not match the lead type in the customer brief.');
  if(!d.fit)reasons.push('Explain the match to this customer.');
  if(!d.contact_url)reasons.push('Add the published contact route.');
  if(['closed','expired','excluded'].includes(d.source_status))reasons.push('Source is '+d.source_status+(d.status_note?': '+d.status_note:'.'));
  if(d.source_status==='unconfirmed'&&(d.lead_kind!=='company_fit'||d.status_note))notes.push(d.status_note||'Current availability has not been confirmed.');
  if(d.published_on>today)reasons.push('The original request date is in the future.');
  if(d.checked_at&&Date.parse(d.checked_at)>Date.parse(at))reasons.push('The source checked time is in the future.');
  if(d.deadline_at&&Date.parse(d.deadline_at)<Date.parse(at))reasons.push('The published exact deadline has passed.');
  else if(d.deadline_on&&d.deadline_on<today)reasons.push('The published deadline date has passed.');
  const freshnessDate=d.lead_kind==='company_fit'?d.checked_at.slice(0,10):d.published_on;
  if(b.max_age_days&&freshnessDate){
    const age=Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(freshnessDate+'T12:00:00Z'))/86400000);
    if(age>b.max_age_days)reasons.push(d.lead_kind==='company_fit'?'The company source was checked earlier than the customer brief permits.':'The original request is older than the customer brief permits.');
  }
  if(d.company_domain&&b.excluded_domains.includes(d.company_domain))reasons.push('Company is on the customer exclusion list.');
  if(d.source_url&&sourceExcluded(d.source_url,b.excluded_sources))reasons.push('Request is on the customer exclusion list.');
  return {ready:reasons.length===0,reasons,notes};
}
function editionLeads(root,pack,ids,at,ignoreEditionIds=[]){
  need(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Select distinct lead records.');
  const leads=ids.map(value=>find(root.leads,value,'lead'));
  need(leads.every(row=>row.pack_id===pack.id),'Select leads from the same customer brief.');
  const problems=leads.flatMap(row=>quality(row,pack,at).reasons.map(reason=>({lead_id:row.id,reason})));
  need(!problems.length,'Complete the selected leads before preparing the customer pack.',422,problems);
  const selectedKeys=[];
  for(const row of leads){
    const candidate=keys(row.document);
    need(!intersects(selectedKeys,candidate),'The selection repeats the same company or buyer request.',422,{lead_id:row.id});
    selectedKeys.push(...candidate);
  }
  const customer=customerKeys(pack.document.customer);
  const used=root.editions.filter(edition=>!withdrawn(root,edition.id)&&!ignoreEditionIds.includes(edition.id)&&intersects(customerKeys(edition.brief.customer),customer))
    .flatMap(edition=>edition.leads.flatMap(row=>keys(row.document)));
  for(const row of leads)need(!intersects(used,keys(row.document)),
    'This customer already has that lead in a prepared sample or delivery. Select an additional lead.',422,{lead_id:row.id});
  return clone(leads);
}
function freezeEdition(root,pack,input,at){
  const editionId=id(input.id,'edition ID');need(!root.editions.some(row=>row.id===editionId),'That edition ID already exists.',409);
  const kind=choice(input.kind,['sample','paid','replacement'],'sample, paid pack or replacement');
  let leads,replaces='',changes=[],editionBrief=pack.document,briefRevision=pack.revision;
  if(kind==='replacement'){
    const base=find(root.editions,id(input.replaces,'original edition ID'),'original customer edition');
    need(base.pack_id===pack.id&&base.kind!=='sample'&&!withdrawn(root,base.id),'Choose the original paid pack or its current replacement.');
    need(!root.editions.some(row=>row.replaces===base.id),'Choose the latest replacement edition, so earlier changes are retained.',409);
    need(Array.isArray(input.replacements)&&input.replacements.length,'Specify the leads to replace.');
    need(new Set(input.replacements.map(change=>change.old_id)).size===input.replacements.length,'Replace each original lead once.');
    changes=input.replacements.map(change=>({old_id:id(change.old_id),new_id:id(change.new_id),reason:text(change.reason,'replacement reason',4000,true)}));
    need(changes.every(change=>base.leads.some(row=>row.id===change.old_id)),'Choose original leads from that delivered edition.');
    const additions=editionLeads(root,{...pack,document:base.brief},changes.map(change=>change.new_id),at);
    editionBrief=base.brief;briefRevision=base.brief_revision;
    leads=base.leads.map(row=>{const change=changes.find(c=>c.old_id===row.id);return clone(change?additions.find(v=>v.id===change.new_id):row);});
    const all=[];for(const row of leads){need(!intersects(all,keys(row.document)),'A replacement duplicates a retained company or request.');all.push(...keys(row.document));}
    replaces=base.id;
  }else{
    leads=editionLeads(root,pack,input.lead_ids,at);
    need(leads.length===(kind==='sample'?1:pack.document.brief.quantity),
      kind==='sample'?'Choose one free sample.':'Choose exactly '+pack.document.brief.quantity+' additional leads for this paid pack.');
  }
  const document={version:EDITION,id:editionId,pack_id:pack.id,kind,prepared_at:at,brief:clone(editionBrief),brief_revision:briefRevision,
    leads,replaces,replacements:changes,currency:editionBrief.brief.currency,
    price_minor:kind==='paid'?editionBrief.brief.price_minor:0};
  const edition={...document,sha256:hash(document)};root.editions.push(edition);return edition;
}
function exportWorkingRecord(root,packId,{includeReconciliation=true}={}){
  const pack=find(root.packs,packId,'customer brief');
  const retainedSources=includeReconciliation?(root.reconciliation_sources||[]).filter(row=>row.pack_id===packId):[];
  const retainedReviews=includeReconciliation?(root.reconciliation_reviews||[]).filter(row=>row.pack_id===packId):[];
  const document={version:BUNDLE,pack:clone(pack),leads:clone(root.leads.filter(row=>row.pack_id===packId)),
    editions:clone(root.editions.filter(row=>row.pack_id===packId)),
    withdrawals:clone(root.withdrawals.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId))),
    deliveries:clone(root.deliveries.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId))),
    ...(root.commercial_links?{commercial_links:clone(root.commercial_links.filter(row=>row.pack_id===packId))}:{}),
    ...(root.commercial_deliveries?{commercial_deliveries:clone(root.commercial_deliveries.filter(row=>row.pack_id===packId))}:{}),
    ...(root.delivery_feedback||root.delivery_feedback_sources?feedbackForPack(root,packId):{}),
    ...(root.delivery_followups?{delivery_followups:clone(root.delivery_followups.filter(row=>row.pack_id===packId))}:{}),
    ...customerRequests.forPack(root,packId),...customerFiles.forPack(root,packId),
    ...(retainedSources.length?{reconciliation_sources:clone(retainedSources)}:{}),
    ...(retainedReviews.length?{reconciliation_reviews:clone(retainedReviews)}:{})};
  const captures=capture.captureForPack(root,packId);
  if(captures.plans.length){document.version=capture.BUNDLE;document.captures=captures;}
  if(retainedSources.length)document.version=RECONCILIATION_BUNDLE;
  return {...document,sha256:hash(document)};
}
function recordVersions(row){
  return [...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,updated_at:row.updated_at}];
}
function workingRecordRoot(bundle){
  need(plain(bundle)&&[BUNDLE,capture.BUNDLE,RECONCILIATION_BUNDLE].includes(bundle.version),'Choose a complete lead working record.');
  if(bundle.version===RECONCILIATION_BUNDLE)
    need(Array.isArray(bundle.reconciliation_sources)&&bundle.reconciliation_sources.length>0,'Retain the complete reconciliation sources in this v3 record.');
  else{
    need(bundle.reconciliation_sources===undefined&&bundle.reconciliation_reviews===undefined,'Use a v3 working record to retain its reconciliation source history.');
    need(bundle.captures===undefined?bundle.version===BUNDLE:bundle.version===capture.BUNDLE,'Use the complete capture-compatible working record.');
  }
  const {sha256,...document}=bundle;need(sha256===hash(document),'The complete working record differs from its original content.');
  const candidate={...empty(),packs:[bundle.pack],leads:bundle.leads,editions:bundle.editions,deliveries:bundle.deliveries,withdrawals:bundle.withdrawals,...(bundle.captures?{captures:bundle.captures}:{}),
    ...(bundle.commercial_links?{commercial_links:bundle.commercial_links}:{}),
    ...(bundle.commercial_deliveries?{commercial_deliveries:bundle.commercial_deliveries}:{}),
    ...(bundle.delivery_feedback?{delivery_feedback:bundle.delivery_feedback}:{}),
    ...(bundle.delivery_feedback_sources?{delivery_feedback_sources:bundle.delivery_feedback_sources}:{}),
    ...(bundle.delivery_followups?{delivery_followups:bundle.delivery_followups}:{}),
    ...Object.fromEntries([...customerRequests.FIELDS,...customerFiles.FIELDS].filter(key=>bundle[key]!==undefined).map(key=>[key,bundle[key]])),
    ...(bundle.reconciliation_sources?{reconciliation_sources:bundle.reconciliation_sources}:{}),
    ...(bundle.reconciliation_reviews?{reconciliation_reviews:bundle.reconciliation_reviews}:{})};
  validateRoot({lead_fulfillment:candidate});return candidate;
}
function reconciliationAPI(){
  return {hash,normalizePack,normalizeLead,revision,keys,
    workingRecord:(root,packId)=>exportWorkingRecord(root,packId,{includeReconciliation:false}),
    validateBundle:bundle=>{const source=workingRecordRoot(bundle);
      const {report}=reconcileWorkingRecord(empty(),bundle,{validated:true});
      need(report.can_receive,'The retained incoming source needs its complete original histories and references.',422,report.conflicts);return source;},
    validateCandidate:(root,candidate,packId)=>reconcileWorkingRecord(root,exportWorkingRecord(candidate,packId,{includeReconciliation:false}))};
}
function reconcileWorkingRecord(original,bundle,{inPlace=false,validated=false}={}){
  if(!validated)workingRecordRoot(bundle);
  const root=inPlace?original:clone(original),packId=bundle.pack.id,existing=root.packs.find(row=>row.id===packId);
  const report={pack_id:packId,customer:bundle.pack.document.customer.name,title:bundle.pack.document.brief.title,
    incoming_sha256:bundle.sha256,existing:Boolean(existing),can_receive:true,
    added:{briefs:0,leads:0,editions:0,deliveries:0,withdrawals:0,commercial_links:0,commercial_deliveries:0,delivery_feedback:0,delivery_feedback_sources:0,delivery_followups:0,reconciliation_sources:0,reconciliation_reviews:0},advanced:{briefs:0,leads:0},
    kept_current:0,unchanged:0,records:[],conflicts:[]};
  const conflict=(entity,recordId,reason,extra={})=>report.conflicts.push({entity,id:recordId,reason,...extra});
  const record=(entity,row,action)=>report.records.push({entity,id:row.id,
    name:entity==='briefs'?row.document.customer.name:entity==='leads'?row.document.organization:row.id,
    action,...(row.revision?{revision:row.revision}:{})});
  function mergeMutable(key,row,entity){
    const current=root[key].find(old=>old.id===row.id);
    if(!current){root[key].push(clone(row));report.added[entity]++;record(entity,row,'add');return;}
    if(key==='leads'&&current.pack_id!==packId){conflict(entity,row.id,'This record ID belongs to another customer pack.');return;}
    const local=recordVersions(current),incoming=recordVersions(row);
    const diverged=local.findIndex((version,i)=>i<incoming.length&&hash(version)!==hash(incoming[i]));
    if(diverged!==-1){conflict(entity,row.id,'The two copies contain different work at revision '+(diverged+1)+'.',
      {local_revision:current.revision,incoming_revision:row.revision});return;}
    if(incoming.length>local.length){
      root[key][root[key].indexOf(current)]=clone(row);report.advanced[entity]++;record(entity,row,'advance');
    }else if(incoming.length<local.length){report.kept_current++;record(entity,current,'keep_current');}
    else{report.unchanged++;record(entity,current,'unchanged');}
  }
  mergeMutable('packs',bundle.pack,'briefs');
  for(const row of bundle.leads)mergeMutable('leads',row,'leads');
  for(const key of ['editions','deliveries','withdrawals','commercial_links','commercial_deliveries','delivery_feedback_sources','delivery_feedback','delivery_followups','reconciliation_sources','reconciliation_reviews'])for(const row of bundle[key]||[]){
    if(!root[key])root[key]=[];
    const current=root[key].find(old=>old.id===row.id);
    if(!current){root[key].push(clone(row));report.added[key]++;record(key,row,'add');}
    else if(key==='delivery_feedback'&&compatibleDeliveryFeedback(root,current,row)){
      report.unchanged++;record(key,current,'unchanged');
    }else if(hash(current)!==hash(row))conflict(key,row.id,'The original saved '+key.slice(0,-1)+' has different content.');
    else{report.unchanged++;record(key,row,'unchanged');}
  }
  capture.mergeCaptures(root,bundle.captures,packId,report);
  customerRequests.merge(root,bundle,report);
  customerFiles.merge(root,bundle,report);
  const mergedPack=root.packs.find(row=>row.id===packId);
  const ownEditions=root.editions.filter(row=>row.pack_id===packId);
  const ownIds=new Set(ownEditions.map(row=>row.id)),allEditions=new Map(root.editions.map(row=>[row.id,row])),allLeads=new Map(root.leads.map(row=>[row.id,row]));
  const versionAt=(row,version)=>row&&recordVersions(row).find(old=>old.revision===version);
  const successors=new Map(),eventDestinations=new Map(),withdrawnIds=new Set();
  for(const edition of ownEditions){
    const brief=versionAt(mergedPack,edition.brief_revision);
    if(!brief||hash(brief.document)!==hash(edition.brief))
      conflict('editions',edition.id,'The prepared brief does not match its retained original revision.');
    for(const lead of edition.leads){
      const saved=allLeads.get(lead.id),version=saved?.pack_id===packId?versionAt(saved,lead.revision):null;
      if(!version||version.sha256!==lead.sha256||version.updated_at!==lead.updated_at)
        conflict('editions',edition.id,'A prepared lead differs from its retained original revision.',{lead_id:lead.id});
    }
    if(edition.kind==='replacement'){
      const selectedBase=allEditions.get(edition.replaces),base=selectedBase?.pack_id===packId?selectedBase:null;
      if(!base||base.kind==='sample'||Date.parse(base.prepared_at)>Date.parse(edition.prepared_at))
        conflict('editions',edition.id,'The original paid edition for this replacement is missing or later than the replacement.');
      if(successors.has(edition.replaces))conflict('editions',edition.id,'Two copies prepared different replacements for the same edition.',
        {other_id:successors.get(edition.replaces)});
      successors.set(edition.replaces,edition.id);
      const changes=edition.replacements;
      if(!Array.isArray(changes)||!changes.length||new Set(changes.map(c=>c.old_id)).size!==changes.length)
        conflict('editions',edition.id,'The complete replacement mapping is missing or repeated.');
      else if(base){
        const changed=new Set(changes.map(c=>c.old_id));
        const expected=base.leads.map(lead=>changes.find(c=>c.old_id===lead.id)?.new_id||lead.id);
        if(changes.some(c=>!base.leads.some(lead=>lead.id===c.old_id)||!c.reason)||
          hash(expected)!==hash(edition.leads.map(lead=>lead.id))||
          base.leads.some(lead=>!changed.has(lead.id)&&hash(lead)!==hash(edition.leads.find(next=>next.id===lead.id)))||
          hash(base.brief)!==hash(edition.brief)||base.brief_revision!==edition.brief_revision)
          conflict('editions',edition.id,'The replacement does not preserve its original brief, unchanged leads and complete replacement mapping.');
      }
    }else if(edition.replaces||edition.replacements?.length)
      conflict('editions',edition.id,'An original customer edition contains a replacement mapping.');
  }
  for(const withdrawal of root.withdrawals.filter(row=>ownIds.has(row.edition_id))){
    const edition=ownEditions.find(row=>row.id===withdrawal.edition_id);
    instant(withdrawal.occurred_at,'withdrawal time',true);text(withdrawal.reason,'withdrawal reason',4000,true);
    if(withdrawnIds.has(edition.id))conflict('withdrawals',withdrawal.id,'The edition has more than one withdrawal.');
    withdrawnIds.add(edition.id);
    if(Date.parse(withdrawal.occurred_at)<Date.parse(edition.prepared_at)||successors.has(edition.id))
      conflict('withdrawals',withdrawal.id,'The withdrawal conflicts with the prepared edition or its replacement.');
  }
  for(const delivery of root.deliveries){
    const key=JSON.stringify([delivery.channel,delivery.provider_id,delivery.destination]);
    const old=eventDestinations.get(key);eventDestinations.set(key,delivery);
    if(old&&(ownIds.has(delivery.edition_id)||ownIds.has(old.edition_id)))
      conflict('deliveries',delivery.id,'The same provider message is attached to more than one saved delivery.',{other_id:old.id});
    if(!ownIds.has(delivery.edition_id))continue;
    const edition=ownEditions.find(row=>row.id===delivery.edition_id);
    instant(delivery.delivered_at,'delivery time',true);text(delivery.channel,'delivery channel',120,true);
    text(delivery.destination,'delivery destination',1000,true);text(delivery.provider_id,'provider message or file ID',500,true);
    web(delivery.receipt_url,'delivery receipt URL');text(delivery.note,'delivery note',4000);
    if(Date.parse(delivery.delivered_at)<Date.parse(edition.prepared_at)||withdrawnIds.has(edition.id))
      conflict('deliveries',delivery.id,'The delivery conflicts with its prepared edition or withdrawal.');
  }
  const ancestor=edition=>{
    const seen=new Set();let current=edition;
    while(current.replaces){
      if(seen.has(current.id)){conflict('editions',edition.id,'The replacement history contains a cycle.');return edition.id;}
      seen.add(current.id);const parent=allEditions.get(current.replaces);
      if(!parent||parent.pack_id!==edition.pack_id)return edition.id;current=parent;
    }
    return current.id;
  };
  const active=root.editions.filter(row=>!withdrawn(root,row.id)),reservations=new Map();
  for(const edition of active){
    const branch=ancestor(edition),customer=customerKeys(edition.brief.customer),selected=[];
    for(const lead of edition.leads){
      const leadKeys=keys(lead.document);
      if(edition.pack_id===packId&&intersects(selected,leadKeys))
        conflict('editions',edition.id,'The selected edition repeats a company or request.',{lead_id:lead.id});
      selected.push(...leadKeys);
      const addresses=customer.flatMap(buyer=>leadKeys.map(key=>JSON.stringify([buyer,key])));
      let duplicate=null;
      for(const address of addresses){
        duplicate=(reservations.get(address)||[]).find(old=>old.branch!==branch&&(edition.pack_id===packId||old.pack_id===packId));
        if(duplicate)break;
      }
      if(duplicate)conflict('editions',edition.id,'Separate customer editions reserve the same company or request.',
        {lead_id:lead.id,other_id:duplicate.edition_id});
      const row={branch,pack_id:edition.pack_id,edition_id:edition.id};
      for(const address of addresses){
        const saved=reservations.get(address)||[];
        if(!saved.some(old=>old.branch===branch&&old.pack_id===edition.pack_id))saved.push(row);
        reservations.set(address,saved);
      }
    }
  }
  for(const key of ['commercial_links','commercial_deliveries']){
    const grouped=new Map();
    for(const row of root[key]||[]){
      if(key==='commercial_links'&&(root[key]||[]).some(next=>next.previous_id===row.id))continue;
      const identity=key==='commercial_links'?row.edition_id:row.delivery_id,prior=grouped.get(identity);
      if(prior&&(row.pack_id===packId||prior.pack_id===packId))
        conflict(key,row.id,'The copies link the same original customer work to different commercial records.',{other_id:prior.id});
      grouped.set(identity,row);
    }
  }
  try{validateDeliveryFeedback(root);}
  catch(error){conflict('delivery_history',packId,error.message);}
  const importedLeadIds=new Set(bundle.leads.map(row=>row.id));
  report.local_records_preserved=root.leads.filter(row=>row.pack_id===packId&&!importedLeadIds.has(row.id)).length;
  report.can_receive=report.conflicts.length===0;
  report.changed=Object.values(report.added).some(Boolean)||Object.values(report.advanced).some(Boolean);
  return {root,report};
}

function isWorkspaceRecord(bundle){
  return plain(bundle)&&(bundle.version===WORKSPACE_BUNDLE||
    Object.keys(bundle).length===1&&plain(bundle.lead_fulfillment)&&bundle.lead_fulfillment.version===VERSION);
}
function exportWorkspaceRecord(root){
  const document={version:WORKSPACE_BUNDLE,workspace:clone(root)};
  return {...document,sha256:hash(document)};
}
function workspaceSource(bundle){
  need(isWorkspaceRecord(bundle),'Choose the complete lead workspace record.');
  if(bundle.version===WORKSPACE_BUNDLE){
    const {sha256,...document}=bundle;
    need(sha256===hash(document),'The complete lead workspace differs from its saved content.');
    need(plain(bundle.workspace)&&bundle.workspace.version===VERSION,'The complete lead workspace body is missing.');
    return validateRoot({lead_fulfillment:bundle.workspace});
  }
  // Continue original lead-only workspace downloads without importing another domain.
  return validateRoot(bundle);
}
function reconcileWorkspaceRecord(original,bundle){
  const source=workspaceSource(bundle),root=clone(original),incomingIds=new Set(source.packs.map(row=>row.id));
  const report={workspace:true,pack_ids:[...incomingIds],customer:source.packs.length+' customer briefs',
    title:'Complete lead fulfillment workspace',incoming_sha256:bundle.sha256||hash(bundle),
    source_root_sha256:hash(source),can_receive:true,
    added:{briefs:0,leads:0,editions:0,deliveries:0,withdrawals:0,commercial_links:0,commercial_deliveries:0,delivery_feedback:0,delivery_feedback_sources:0,delivery_followups:0,operations:0,workspace_fields:0},
    advanced:{briefs:0,leads:0},kept_current:0,unchanged:0,local_records_preserved:0,
    local_packs_preserved:original.packs.filter(row=>!incomingIds.has(row.id)).length,
    packs:[],records:[],conflicts:[]};
  // One private candidate and one final save cover every customer. The established
  // single-pack reconciler still owns histories, reservations, captures and commerce.
  for(const pack of source.packs){
    const received=reconcileWorkingRecord(root,exportWorkingRecord(source,pack.id),{inPlace:true,validated:true}).report;
    const {records,conflicts,...summary}=received;report.packs.push(summary);
    for(const [key,count]of Object.entries(received.added))report.added[key]=(report.added[key]||0)+count;
    for(const [key,count]of Object.entries(received.advanced))report.advanced[key]=(report.advanced[key]||0)+count;
    report.kept_current+=received.kept_current;report.unchanged+=received.unchanged;
    report.local_records_preserved+=received.local_records_preserved;
    const context={pack_id:pack.id,customer:pack.document.customer.name};
    report.records.push(...records.map(row=>({...context,...row})));
    report.conflicts.push(...conflicts.map(row=>({...context,...row})));
  }
  const operations=new Map(root.operations.map(row=>[row.id,row]));
  for(const row of source.operations){
    id(row.id,'source operation ID');text(row.kind,'source operation kind',160,true);
    instant(row.occurred_at,'source operation time',true);
    need(/^[a-f0-9]{64}$/.test(row.request_sha256)&&plain(row.result),'The original source operation is incomplete.');
    const current=operations.get(row.id);
    if(!current){
      root.operations.push(clone(row));operations.set(row.id,row);report.added.operations++;
      report.records.push({entity:'operations',id:row.id,name:row.kind,action:'add'});
    }else if(hash(current)!==hash(row)){
      report.conflicts.push({entity:'operations',id:row.id,reason:'The same operation ID has a different original request or saved result.'});
    }else report.unchanged++;
  }
  // Preserve additions from compatible workspace extensions as complete values.
  // Divergent extension values stay visible for their owning product to reconcile.
  const handled=new Set(['version','packs','leads','editions','deliveries','withdrawals','operations','captures','commercial_links','commercial_deliveries','delivery_feedback','delivery_feedback_sources','delivery_followups',...customerRequests.FIELDS,...customerFiles.FIELDS,'reconciliation_sources','reconciliation_reviews']);
  for(const key of Object.keys(source).filter(key=>!handled.has(key))){
    if(!Object.prototype.hasOwnProperty.call(root,key)){
      Object.defineProperty(root,key,{value:clone(source[key]),enumerable:true,writable:true,configurable:true});
      report.added.workspace_fields++;report.records.push({entity:'workspace_fields',id:key,name:key,action:'add'});
    }else if(hash(root[key])!==hash(source[key])){
      report.conflicts.push({entity:'workspace_fields',id:key,reason:'This workspace extension contains different work. Reconcile its complete values through the original product.'});
    }else report.unchanged++;
  }
  // Empty optional stores have a meaningful complete shape even with no packs.
  for(const key of ['captures','commercial_links','commercial_deliveries','delivery_feedback','delivery_followups',...customerFiles.FIELDS,'reconciliation_sources','reconciliation_reviews'])
    if(source[key]!==undefined&&root[key]===undefined)root[key]=clone(source[key]);
  // Retain complete source captures even when their report has no customer match yet.
  for(const row of source.delivery_feedback_sources||[]){
    const saved=(root.delivery_feedback_sources||[]).find(value=>value.id===row.id);
    if(!saved){(root.delivery_feedback_sources??=[]).push(clone(row));report.added.delivery_feedback_sources++;}
    else if(hash(saved)!==hash(row))report.conflicts.push({entity:'delivery_feedback_sources',id:row.id,reason:'The same original native source has different content.'});
  }
  report.can_receive=report.conflicts.length===0;
  report.changed=Object.values(report.added).some(Boolean)||Object.values(report.advanced).some(Boolean);
  return {root,report};
}
function receiveWorkspaceRecord(root,bundle,operationId){
  return receiveReconciledWorkspace(root,reconcileWorkspaceRecord(root,bundle),operationId);
}
function receiveReconciledWorkspace(root,merged,operationId){
  need(merged.report.can_receive,'These workspace copies contain conflicting work. Reconcile the listed original records before receiving the complete copy.',409,merged.report.conflicts);
  need(!merged.root.operations.some(row=>row.id===operationId),'This receiving operation ID already exists in the incoming workspace. Save this receive with a new operation ID.',409);
  for(const key of Object.keys(merged.root))
    Object.defineProperty(root,key,{value:merged.root[key],enumerable:true,writable:true,configurable:true});
  return merged.report;
}

function prepareWorkingRecordReceive(original,bundle){
  const merged=isWorkspaceRecord(bundle)?reconcileWorkspaceRecord(original,bundle):reconcileWorkingRecord(original,bundle);
  const {report}=merged;
  return {...merged,preview:{version:report.workspace?'dealscout.lead-workspace-receive-preview.v1':'dealscout.lead-receive-preview.v1',root_sha256:hash(original),...report}};
}
function previewWorkingRecord(ledger,bundle){
  return prepareWorkingRecordReceive(validateRoot(ledger),bundle).preview;
}
function receiveWorkingRecord(root,bundle){
  return receiveReconciledWorkingRecord(root,reconcileWorkingRecord(root,bundle),bundle.pack.id);
}
function receiveReconciledWorkingRecord(root,merged,packId){
  need(merged.report.can_receive,'These copies contain conflicting customer work. Review the listed records in their original histories.',409,merged.report.conflicts);
  for(const key of ['packs','leads','editions','deliveries','withdrawals','commercial_links','commercial_deliveries','delivery_feedback_sources','delivery_feedback','delivery_followups',...customerRequests.FIELDS,...customerFiles.FIELDS,'reconciliation_sources','reconciliation_reviews'])
    if(merged.root[key]!==undefined)root[key]=merged.root[key];
  if(merged.root.captures)root.captures=merged.root.captures;
  return {pack:root.packs.find(row=>row.id===packId),receiving:merged.report};
}
function previewReconciliation(ledger,input,asOf=new Date().toISOString()){
  const root=validateRoot(ledger),at=instant(asOf,'review time',true);
  return {root_sha256:hash(root),...reconciliation.preview(root,input,at,reconciliationAPI())};
}
function applyLeadFulfillment(ledger,body,asOf=new Date().toISOString(),options={}){
  need(plain(body)&&plain(body.input),'Supply the saved operation and input.');
  const operationId=id(body.operation_id,'operation ID'),at=instant(asOf,'operation time',true),original=validateRoot(ledger);
  return applyValidatedLeadFulfillment(ledger,body,at,options,original,operationId);
}
function applyValidatedLeadFulfillment(ledger,body,at,options,original,operationId,prepared=null){
  const requestHash=hash({kind:body.kind,input:body.input,expected_root_sha256:body.expected_root_sha256});
  const prior=original.operations.find(row=>row.id===operationId);
  if(prior){need(prior.request_sha256===requestHash,'The operation ID belongs to a different saved request.',409);
    return {ledger,changed:false,replayed:true,operation_id:operationId,...clone(prior.result)};}
  need(body.expected_root_sha256===hash(original),'The lead workspace changed. Reload its current edition before saving your edits.',409);
  const root=prepared?prepared.root:clone(original),input=body.input;let packId='',result={};
  if(body.kind==='pack-save'){
    packId=id(input.id,'pack ID');const pack=revision(root.packs,packId,normalizePack(input),at);result={pack_id:packId,pack_revision:pack.revision};
  }else if(body.kind==='leads-save'){
    packId=id(input.pack_id,'pack ID');find(root.packs,packId,'customer brief');
    need(Array.isArray(input.leads)&&input.leads.length,'Supply the original lead records.');
    need(new Set(input.leads.map(row=>row.id)).size===input.leads.length,'Use distinct IDs in the imported lead list.');
    const saved=input.leads.map(row=>{
      const leadId=id(row.id,'lead ID'),existing=root.leads.find(old=>old.id===leadId);
      need(!existing||existing.pack_id===packId,'That lead ID belongs to another customer pack.',409);
      return revision(root.leads,leadId,normalizeLead(row.document??row),at,{pack_id:packId});
    });result={pack_id:packId,lead_ids:saved.map(row=>row.id),lead_revisions:saved.map(row=>row.revision)};
  }else if(['customer-files-save','customer-package-prepare'].includes(body.kind)){
    result=customerFiles.apply(root,body.kind,input,at);packId=result.pack_id;
  }else if(body.kind==='edition-prepare'){
    packId=id(input.pack_id,'pack ID');const edition=freezeEdition(root,find(root.packs,packId,'customer brief'),input,at);
    result={pack_id:packId,edition_id:edition.id,edition_sha256:edition.sha256,lead_count:edition.leads.length};
  }else if(body.kind==='edition-withdraw'){
    const edition=find(root.editions,id(input.edition_id,'edition ID'),'prepared edition');packId=edition.pack_id;
    need(!root.deliveries.some(row=>row.edition_id===edition.id),'This edition has an actual delivery. Prepare a replacement to retain the customer history.',409);
    need(!root.editions.some(row=>row.replaces===edition.id),'This edition already has a replacement. Select its latest successor.',409);
    need(!withdrawn(root,edition.id),'This prepared edition is already withdrawn.',409);
    root.withdrawals.push({id:id(input.id,'withdrawal ID'),edition_id:edition.id,occurred_at:at,reason:text(input.reason,'withdrawal reason',4000,true)});
    result={pack_id:packId,edition_id:edition.id,withdrawn:true};
  }else if(body.kind==='delivery-record'){
    const edition=find(root.editions,id(input.edition_id,'edition ID'),'customer edition');packId=edition.pack_id;
    need(!withdrawn(root,edition.id),'Select an active prepared edition to record its delivery.');
    const deliveryId=id(input.id,'delivery ID');need(!root.deliveries.some(row=>row.id===deliveryId),'That delivery is already recorded.',409);
    const deliveredAt=instant(input.delivered_at,'actual delivery time',true);
    need(Date.parse(deliveredAt)<=Date.parse(at),'Record an existing delivery.');
    need(Date.parse(deliveredAt)>=Date.parse(edition.prepared_at),'The delivery time precedes this prepared edition.');
    const row={id:deliveryId,edition_id:edition.id,delivered_at:deliveredAt,
      channel:text(input.channel,'delivery channel',120,true),destination:text(input.destination,'actual destination',1000,true),
      provider_id:text(input.provider_id,'provider message or file ID',500,true),receipt_url:web(input.receipt_url,'delivery receipt URL'),
      note:text(input.note,'delivery note',4000),...customerFiles.deliveryFields(root,input,edition.id,deliveredAt)};
    if(input.previous_delivery_id){
      const previous=find(root.deliveries,id(input.previous_delivery_id,'earlier delivery ID'),'earlier delivery');
      need(previous.edition_id===edition.id,'Keep the follow-up with the same prepared customer edition.');
      need(Date.parse(deliveredAt)>=Date.parse(previous.delivered_at),'The follow-up delivery precedes its earlier attempt.');
      row.previous_delivery_id=previous.id;row.previous_delivery_sha256=hash(previous);
    }
    const duplicated=root.deliveries.find(old=>old.channel===row.channel&&old.provider_id===row.provider_id&&old.destination===row.destination);
    need(!duplicated,'That provider delivery is already attached to a saved customer edition.',409);
    root.deliveries.push(row);result={pack_id:packId,edition_id:edition.id,delivery_id:row.id};
  }else if(['customer-request-receive','customer-request-review','customer-request-replace'].includes(body.kind)){
    result=customerRequests.apply(root,body.kind,input,at,editionInput=>
      freezeEdition(root,find(root.packs,editionInput.pack_id,'customer brief'),editionInput,at));
    packId=result.pack_id;
  }else if(body.kind==='delivery-followup-link'){
    const previous=find(root.deliveries,id(input.previous_delivery_id,'earlier delivery ID'),'earlier delivery');
    const delivery=find(root.deliveries,id(input.delivery_id,'follow-up delivery ID'),'recorded follow-up delivery');
    const edition=find(root.editions,delivery.edition_id,'original customer edition');packId=edition.pack_id;
    need(previous.id!==delivery.id&&previous.edition_id===edition.id,
      'Link two different recorded deliveries of the same prepared customer edition.');
    need(Date.parse(delivery.delivered_at)>=Date.parse(previous.delivered_at)&&Date.parse(delivery.delivered_at)<=Date.parse(at),
      'Select an actual later delivery on this original customer edition.');
    need(!deliveryParent(root,delivery.id),'This recorded delivery already follows an earlier attempt.',409);
    const followupId=id(input.id,'delivery association ID');
    need(!(root.delivery_followups||[]).some(row=>row.id===followupId),'That delivery association is already recorded.',409);
    const document={version:FOLLOWUP,id:followupId,pack_id:packId,edition_id:edition.id,edition_sha256:edition.sha256,
      previous_delivery_id:previous.id,previous_delivery_sha256:hash(previous),
      delivery_id:delivery.id,delivery_sha256:hash(delivery),recorded_at:at,
      note:text(input.note,'association note',4000,true),
      source_ids:input.source_ids!==undefined?clone(input.source_ids):
        feedbackSources(root).filter(source=>source.kind==='sent'&&[previous,delivery].some(row=>
          row.provider_id===source.provider_id&&Date.parse(row.delivered_at)===Date.parse(source.occurred_at)))
          .map(source=>source.id).sort()};
    (root.delivery_followups??=[]).push({...document,sha256:hash(document)});
    result={pack_id:packId,edition_id:edition.id,followup_id:followupId,
      previous_delivery_id:previous.id,delivery_id:delivery.id,linked:true};
  }else if(body.kind==='delivery-feedback-receive'){
    need(typeof options.deliveryFeedback==='function','Open the native lead workspace to receive this delivery report.');
    const preview=options.deliveryFeedback(ledger,input);
    need(preview.input_sha256===hash(input),'The delivery report preview belongs to another original request.',409);
    result=appendDeliveryFeedback(root,preview,at);packId=result.pack_id;
  }else if(body.kind==='reconciliation-stage'){
    result=reconciliation.stage(root,input,at,reconciliationAPI());packId=result.pack_id;
  }else if(body.kind==='reconciliation-apply'){
    result=reconciliation.apply(root,input,at,reconciliationAPI());packId=result.pack_id;
  }else if(['capture-plan','capture-receive','capture-review'].includes(body.kind)){
    result=capture.applyCapture(root,body.kind,input,at);packId=result.pack_id;
  }else if(body.kind==='workspace-record-receive'){
    const receiving=prepared?receiveReconciledWorkspace(root,prepared,operationId):receiveWorkspaceRecord(root,input.bundle,operationId);
    result={pack_id:'',pack_ids:receiving.pack_ids,received:true,workspace_received:true,receiving};
  }else if(body.kind==='working-record-receive'){
    const received=prepared?receiveReconciledWorkingRecord(root,prepared,input.bundle.pack.id):receiveWorkingRecord(root,input.bundle);packId=received.pack.id;result={pack_id:packId,received:true,receiving:received.receiving};
  }else throw issue(422,'Choose a supported lead fulfillment operation.');
  root.operations.push({id:operationId,kind:body.kind,request_sha256:requestHash,occurred_at:at,result:clone(result)});
  const next={...ledger,lead_fulfillment:root};validateRoot(next);
  return {ledger:next,changed:true,replayed:false,operation_id:operationId,...result};
}
function leadFulfillmentState(ledger,{packId='',asOf=new Date().toISOString()}={}){
  const root=validateRoot(ledger),at=instant(asOf,'current time',true);
  const packs=root.packs.map(pack=>({id:pack.id,revision:pack.revision,customer:pack.document.customer.name,title:pack.document.brief.title,
    quantity:pack.document.brief.quantity,currency:pack.document.brief.currency,price_minor:pack.document.brief.price_minor,
    leads:root.leads.filter(row=>row.pack_id===pack.id).length,editions:root.editions.filter(row=>row.pack_id===pack.id).length,updated_at:pack.updated_at,
    delivery_attention:root.deliveries.filter(row=>root.editions.some(edition=>edition.id===row.edition_id&&edition.pack_id===pack.id)&&
      deliveryFeedbackState(root,row.id).needs_attention).length}));
  const pack=packId?find(root.packs,packId,'customer brief'):null;
  const rows=pack?root.leads.filter(row=>row.pack_id===packId):[];
  const customer=pack?customerKeys(pack.document.customer):[];
  const previous=root.editions.filter(row=>!withdrawn(root,row.id)&&intersects(customerKeys(row.brief.customer),customer)).flatMap(row=>row.leads.flatMap(lead=>keys(lead.document)));
  return {version:VERSION,root_sha256:hash(root),as_of_at:at,packs,selected:pack?{pack:clone(pack),
    leads:rows.map(row=>({...clone(row),quality:quality(row,pack,at),
      duplicates:rows.filter(other=>other.id!==row.id&&intersects(keys(row.document),keys(other.document))).map(other=>other.id),
      used:intersects(keys(row.document),previous)})),
    editions:root.editions.filter(row=>row.pack_id===packId).map(row=>({...clone(row),withdrawn:withdrawn(root,row.id)})),
    deliveries:clone(root.deliveries.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId))),
    delivery_feedback:clone(feedbackRows(root).filter(row=>row.pack_id===packId)),
    delivery_followups:clone((root.delivery_followups||[]).filter(row=>row.pack_id===packId)),
    delivery_states:root.deliveries.filter(row=>root.editions.some(edition=>edition.id===row.edition_id&&edition.pack_id===packId)).map(row=>deliveryFeedbackState(root,row.id)),
    delivery_feedback_sources:feedbackForPack(root,packId).delivery_feedback_sources.map(({native_message,saved_sent,...source})=>source),
    customer_requests:customerRequests.view(root,packId),
    customer_files:customerFiles.view(root,packId),
    customer_request_delivery_sha256:Object.fromEntries(root.deliveries.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId)).map(row=>[row.id,hash(row)])),
    captures:capture.captureForPack(root,packId),reconciliations:reconciliation.list(root,packId)}:null};
}
function customerEdition(edition){
  return {version:EDITION,title:edition.kind==='sample'?'Free lead sample':edition.brief.brief.title,customer:edition.brief.customer.name,prepared_at:edition.prepared_at,
    delivery_type:edition.kind,criteria:edition.brief.brief.description,geography:edition.brief.brief.geography,
    skills:clone(edition.brief.brief.skills),quantity:edition.leads.length,currency:edition.currency,price_minor:edition.price_minor,
    leads:edition.leads.map(row=>{const d=row.document;return {organization:d.organization,company_url:d.company_url,person:d.person,
      business_need:d.demand,source_url:d.source_url,original_request_date:d.published_on,last_buyer_update:d.author_updated_on,source_checked_at:d.checked_at,signal_type:d.lead_kind,
      deadline:d.deadline_at||d.deadline_on,contact_route:d.contact_url,contact_instructions:d.contact_instructions,
      geography:d.geography,published_budget:d.budget,why_it_fits:d.fit,opening_message:d.opening_message,
      source_status:d.source_status,status_note:d.status_note,
      ...(Object.hasOwn(d,'source_time_observation')?{source_time_observation:clone(d.source_time_observation)}:{})};})};
}
function exportFromRoot(root,{packId,editionId='',capturePlanId='',reconciliationId='',format='json'}={}){

  if(format==='workspace-record')return {name:'lead-fulfillment-workspace.json',value:exportWorkspaceRecord(root)};
  if(format==='working-records')return {name:'lead-fulfillment-working-records.json',value:root.packs.map(pack=>exportWorkingRecord(root,pack.id))};
  const pack=find(root.packs,packId,'customer brief');
  if(format==='reconciliation-record'){
    const value=reconciliation.record(root,id(reconciliationId,'source ID'));
    need(value.source.pack_id===pack.id,'Choose a source from this customer pack.');
    return {name:(reconciliationId+'-reconciliation.json').replace(/:/g,'-'),value};
  }
  if(['capture-jobs','capture-record'].includes(format)){
    const captures=capture.captureForPack(root,pack.id),plan=find(captures.plans,capturePlanId,'capture plan');
    const value=format==='capture-jobs'?clone(plan.source_jobs):{version:'dealscout.capture-record.v1',plan,
      results:captures.results.filter(r=>r.plan_id===plan.id),reviews:captures.reviews.filter(r=>captures.results.some(x=>x.id===r.result_id&&x.plan_id===plan.id))};
    return {name:(plan.id+'-'+format+'.json').replace(/:/g,'-'),value};
  }
  if(format==='working-record')return {name:(pack.id+'-working-record.json').replace(/:/g,'-'),value:exportWorkingRecord(root,pack.id)};
  const edition=find(root.editions,editionId,'prepared edition');need(edition.pack_id===pack.id,'Choose an edition from this customer brief.');
  const selected={name:(pack.id+'-'+edition.id+'.json').replace(/:/g,'-'),value:customerEdition(edition),edition_sha256:edition.sha256};
  if(format!=='customer-handover')return selected;
  const previous=edition.replaces?root.editions.find(row=>row.id===edition.replaces):null;
  need(!edition.replaces||(previous&&previous.pack_id===edition.pack_id),'Open the complete original replacement history before exporting this pack.');
  const changes=(edition.replacements||[]).map(change=>{
    const before=previous?.leads.find(row=>row.id===change.old_id),after=edition.leads.find(row=>row.id===change.new_id);
    need(before&&after,'The replacement needs its complete original and selected lead records.');
    return {previous_company:before.document.organization,replacement_company:after.document.organization};
  });
  return {...selected,value:{edition:selected.value,edition_sha256:selected.edition_sha256,
    handover:{version:'dealscout.lead-customer-handover.v1',
      previous_prepared_at:previous?.prepared_at||'',changes,
      retained_leads:previous?edition.leads.filter(row=>!(edition.replacements||[]).some(change=>change.new_id===row.id)).length:0}}};
}
function leadFulfillmentExport(ledger,options={}){
  return exportFromRoot(validateRoot(ledger),options);
}
/** Detach and validate one saved lead root for a complete, repeatable export run. */
function createLeadFulfillmentExporter(ledger){
  need(plain(ledger),'Open the original sales workspace.');
  const root=validateRoot(ledger.lead_fulfillment===undefined?{}:{lead_fulfillment:clone(ledger.lead_fulfillment)});
  return Object.freeze({export:withOperationHashes(options=>exportFromRoot(root,options)),
    customerPackage:withOperationHashes((packageId,packId='')=>clone(customerFiles.packageSelection(root,packageId,packId))),
    customerFile:withOperationHashes(({packId,id,revision,sha256})=>clone(customerFiles.version(root,{id,revision,sha256},packId)))});
}
/** Assemble complete source records against one detached, validated lead root.
 * A clean changed preview commits that exact candidate through normal apply.
 * Conflicts and unchanged inputs leave the private root untouched; unchanged
 * inputs follow collection assembly's existing skip policy and do not create or
 * replay saved operations. Native request replay/CAS uses applyLeadFulfillment.
 */
function createLeadFulfillmentAssembly(ledger){
  need(plain(ledger),'Open the original sales workspace.');
  let current={...ledger,lead_fulfillment:validateRoot(ledger.lead_fulfillment===undefined?{}:
    {lead_fulfillment:clone(ledger.lead_fulfillment)})};
  return Object.freeze({
    receive:withOperationHashes((bundle,{operationId,asOf=new Date().toISOString()}={})=>{
      const original=current.lead_fulfillment,prepared=prepareWorkingRecordReceive(original,bundle);
      const preview=prepared.preview;
      if(!preview.can_receive||!preview.changed)return {preview,changed:false,replayed:false};
      const operation=id(operationId,'operation ID'),at=instant(asOf,'operation time',true);
      const request={operation_id:operation,kind:isWorkspaceRecord(bundle)?'workspace-record-receive':'working-record-receive',
        input:{bundle},expected_root_sha256:preview.root_sha256};
      const result=applyValidatedLeadFulfillment(current,request,at,{},original,operation,prepared);
      current=result.ledger;
      const {ledger:received,...outcome}=result;
      return {preview,...outcome};
    }),
    export:withOperationHashes(options=>exportFromRoot(current.lead_fulfillment,options))
  });
}
function leadCustomerPackageSelection(ledger,packageId,packId=''){
  return customerFiles.packageSelection(validateRoot(ledger),packageId,packId);
}
function leadCustomerFileSelection(ledger,{packId,id,revision,sha256}){
  return customerFiles.version(validateRoot(ledger),{id,revision,sha256},packId);
}
function leadCustomerRequestReport(ledger,requestId){return customerRequests.customerReport(validateRoot(ledger),requestId);}
function leadCustomerRequestSource(ledger,requestId){
  const root=validateRoot(ledger),request=find(root.customer_requests||[],requestId,'customer request');
  return clone(find(root.customer_request_sources||[],request.source_id,'complete request source'));
}
module.exports={VERSION,BUNDLE,RECONCILIATION_BUNDLE,WORKSPACE_BUNDLE,EDITION,hash,canonicalURL,
  leadCustomerPackageSelection:withOperationHashes(leadCustomerPackageSelection),
  leadCustomerFileSelection:withOperationHashes(leadCustomerFileSelection),
  leadCustomerRequestReport:withOperationHashes(leadCustomerRequestReport),
  leadCustomerRequestSource:withOperationHashes(leadCustomerRequestSource),
  validateRoot:withOperationHashes(validateRoot),quality,
  applyLeadFulfillment:withOperationHashes(applyLeadFulfillment),
  leadFulfillmentState:withOperationHashes(leadFulfillmentState),
  leadFulfillmentExport:withOperationHashes(leadFulfillmentExport),customerEdition,
  createLeadFulfillmentExporter:withOperationHashes(createLeadFulfillmentExporter),
  createLeadFulfillmentAssembly:withOperationHashes(createLeadFulfillmentAssembly),
  previewWorkingRecord:withOperationHashes(previewWorkingRecord),
  previewReconciliation:withOperationHashes(previewReconciliation)};
