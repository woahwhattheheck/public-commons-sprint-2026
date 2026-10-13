'use strict';
/** Portable recipient feedback over the original public lead edition.
 * The original customer request/replacement engine remains the commercial writer.
 */
function createLeadCustomerReview({sha256Utf8,utf8ByteLength}) {
  const SOURCE='commons.lead-customer-review-source.v1';
  const REVIEW='commons.lead-customer-review.v1';
  const RETURN='commons.lead-customer-review-return.v1';
  const MAX_BYTES=1024*1024,MAX_HISTORY=100;
  const DECISIONS=['keep','question','duplicate','unavailable','outside_brief','incorrect_contact','incorrect_source','other'];
  const DOCUMENT=['version','title','customer','prepared_at','delivery_type','criteria','geography','skills','quantity','currency','price_minor','leads'];
  const LEAD=['organization','company_url','person','business_need','source_url','original_request_date','last_buyer_update','source_checked_at','signal_type','deadline','contact_route','contact_instructions','geography','published_budget','why_it_fits','opening_message','source_status','status_note'];
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=message=>{throw Object.assign(new Error(message),{code:'LEAD_CUSTOMER_REVIEW',status:422});};
  const need=(condition,message)=>{if(!condition)fail(message);};
  need(typeof sha256Utf8==='function'&&typeof utf8ByteLength==='function','Use the maintained complete text hash dependency.');
  const copy=v=>JSON.parse(JSON.stringify(v));
  function exact(v,keys,label) {
    need(plain(v)&&Object.keys(v).sort().join('\0')===keys.slice().sort().join('\0'),'Retain the complete original '+label+'.');
  }
  function canonical(v) {
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(plain(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    need(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v),'Keep exact supported public review values.');
    return JSON.stringify(v);
  }
  const hash=v=>sha256Utf8(canonical(v)).sha256;
  const seal=v=>({...v,sha256:hash(v)});
  function checkSeal(v,label) {need(plain(v),'Retain the original '+label+'.');const {sha256,...body}=v;need(sha256===hash(body),'The '+label+' changed from its complete saved contents.');return v;}
  function text(v,label,max=8000,required=false) {
    need(typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'Use complete text for '+label+'.');
    utf8ByteLength(v);need(!required||v.trim(),'Enter '+label+'.');return v;
  }
  function id(v,label) {text(v,label,160,true);need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v),'Use a stable '+label+'.');return v;}
  function time(v,label) {
    text(v,label,40,true);need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v)),'Use a UTC date and time for '+label+'.');
    const normalized=new Date(v).toISOString();need(normalized.slice(0,19)===v.slice(0,19),'Use a valid calendar time for '+label+'.');return normalized;
  }
  function document(value) {
    exact(value,DOCUMENT,'customer lead document');
    need(value.version==='dealscout.lead-pack.v1','Use the maintained public customer edition.');
    for(const key of DOCUMENT.filter(k=>!['skills','quantity','price_minor','leads'].includes(k)))text(value[key],key,100000);
    time(value.prepared_at,'edition preparation time');
    need(['sample','paid','replacement'].includes(value.delivery_type),'Use the original customer edition type.');
    need(/^[A-Z]{3}$/.test(value.currency)&&Number.isSafeInteger(value.price_minor)&&value.price_minor>=0,'Retain the original customer price.');
    need(Array.isArray(value.skills)&&value.skills.length<=100,'Retain the original service selection.');
    value.skills.forEach(x=>text(x,'service',1000));
    need(Array.isArray(value.leads)&&value.leads.length>0&&value.leads.length<=5000&&value.quantity===value.leads.length,'Retain the complete selected customer lead list.');
    for(const row of value.leads){exact(row,LEAD,'public lead');for(const k of LEAD)text(row[k],k,100000);}
    need(utf8ByteLength(JSON.stringify(value))<=MAX_BYTES/2,'This public edition is too large for an editable return. Use the original customer request intake for its complete source.');
    return copy(value);
  }
  function source(value) {
    exact(value,['edition_id','package_id','package_sha256','document'],'review source selection');
    id(value.edition_id,'original edition ID');id(value.package_id,'original package ID');
    need(/^[a-f0-9]{64}$/.test(value.package_sha256),'Retain the exact original package identity.');
    return seal({version:SOURCE,edition_id:value.edition_id,package_id:value.package_id,package_sha256:value.package_sha256,document:document(value.document)});
  }
  function validateSource(value) {
    exact(value,['version','edition_id','package_id','package_sha256','document','sha256'],'review source');
    need(value.version===SOURCE,'Use the original customer review source version.');
    const result=source({edition_id:value.edition_id,package_id:value.package_id,package_sha256:value.package_sha256,document:value.document});
    need(result.sha256===value.sha256,'The selected public customer source changed.');return result;
  }
  function items(value,original) {
    need(Array.isArray(value)&&value.length<=original.document.leads.length,'Use one review entry per selected original lead.');
    const seen=new Set();
    return value.map(row=>{
      exact(row,['key','decision','statement','requested_remedy'],'lead review entry');
      const match=/^lead-([1-9][0-9]*)$/.exec(row.key);
      need(match&&Number(match[1])<=original.document.leads.length&&!seen.has(row.key),'Choose each original selected lead once.');
      seen.add(row.key);need(DECISIONS.includes(row.decision),'Choose a supported review decision.');
      return {key:row.key,decision:row.decision,statement:text(row.statement,'review statement',8000,true),
        requested_remedy:text(row.requested_remedy,'requested next step',4000)};
    });
  }
  function draft(value,original) {
    exact(value,['author','note','items'],'review draft');
    return {author:text(value.author,'reviewer name',500),note:text(value.note,'review note',12000),items:items(value.items,original)};
  }
  function newReview(original,{id:reviewId,created_at}) {
    validateSource(original);
    return {version:REVIEW,id:id(reviewId,'review ID'),source_sha256:original.sha256,created_at:time(created_at,'review creation'),
      history:[],draft:{author:'',note:'',items:[]}};
  }
  function validateReview(original,value) {
    validateSource(original);exact(value,['version','id','source_sha256','created_at','history','draft'],'editable review');
    need(value.version===REVIEW&&value.source_sha256===original.sha256,'Open the review with its exact original customer source.');
    id(value.id,'review ID');const created=time(value.created_at,'review creation');
    need(Array.isArray(value.history)&&value.history.length<=MAX_HISTORY,'Keep the complete review history within 100 editions.');
    let previous='',last=created;
    for(const [index,row]of value.history.entries()){
      exact(row,['revision','previous_sha256','reviewed_at','author','note','items','sha256'],'saved review edition');checkSeal(row,'review edition');
      need(row.revision===index+1&&row.previous_sha256===previous,'Keep the complete original review ancestry.');
      const at=time(row.reviewed_at,'saved review time');need(Date.parse(at)>=Date.parse(last),'Keep review times in their original order.');
      const validated=draft({author:row.author,note:row.note,items:row.items},original);
      need(validated.items.length>0,'A saved review needs at least one stated lead observation.');
      previous=row.sha256;last=at;
    }
    draft(value.draft,original);
    need(utf8ByteLength(JSON.stringify({source:original,review:value}))<=MAX_BYTES-2048,'This complete review exceeds the original intake size. Keep the last saved file and receive the complete source through the document workspace.');
    return copy(value);
  }
  function setDraft(original,value,changes) {
    const result=validateReview(original,value);result.draft=draft(changes,original);validateReview(original,result);return result;
  }
  function updateReview(original,value,{author,note,items:observations,at}) {
    const result=setDraft(original,value,{author,note,items:observations}),reviewed_at=time(at,'saved review time');
    need(observations.length>0,'State at least one lead observation before saving a review edition.');
    const last=result.history.at(-1);
    need(Date.parse(reviewed_at)>=Date.parse(last?.reviewed_at||result.created_at),'Keep review times in their original order.');
    if(last&&canonical({author:last.author,note:last.note,items:last.items})===canonical(result.draft))return result;
    result.history.push(seal({revision:result.history.length+1,previous_sha256:last?.sha256||'',reviewed_at,...copy(result.draft)}));
    validateReview(original,result);return result;
  }
  function prepareReturn(original,value) {
    const selected=validateReview(original,value),latest=selected.history.at(-1);
    need(latest,'Save a review edition before returning it.');
    need(canonical(selected.draft)===canonical({author:latest.author,note:latest.note,items:latest.items}),'Save the changed review before returning it.');
    const result=seal({version:RETURN,source:copy(original),review:selected});
    need(utf8ByteLength(JSON.stringify(result))<=MAX_BYTES,'The complete return exceeds the original intake size.');return result;
  }
  function readReturn(content) {
    text(content,'complete returned JSON',MAX_BYTES);
    need(utf8ByteLength(content)<=MAX_BYTES,'Keep the complete return within the original intake size.');
    let result;try{result=JSON.parse(content.replace(/^\uFEFF/,''));}catch{fail('Open the complete saved review JSON.');}
    exact(result,['version','source','review','sha256'],'returned review');need(result.version===RETURN,'Choose an original customer review return.');
    checkSeal(result,'returned review');validateSource(result.source);validateReview(result.source,result.review);
    need(prepareReturn(result.source,result.review).sha256===result.sha256,'Retain the selected saved review and source together.');
    return copy(result);
  }
  return Object.freeze({SOURCE,REVIEW,RETURN,MAX_BYTES,DECISIONS:Object.freeze(DECISIONS.slice()),hash,source,validateSource,newReview,validateReview,setDraft,updateReview,prepareReturn,readReturn});
}
module.exports={createLeadCustomerReview};
