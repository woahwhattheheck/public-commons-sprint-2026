'use strict';
/** Customer statements, operator findings and completed lead corrections.
 *
 * These records extend the existing lead ledger. The caller supplies the
 * original edition engine for replacement preparation and owns persistence.
 */
const VERSION='dealscout.lead-customer-requests.v1';
const FIELDS=Object.freeze(['customer_request_sources','customer_requests',
  'customer_request_reviews','customer_request_fulfillments']);
const CATEGORIES=Object.freeze(['unavailable','duplicate','outside_brief',
  'incorrect_contact','incorrect_source','other']);
const DECISIONS=Object.freeze(['replace','decline','needs_information','resolved']);
const MAX_SOURCE_BYTES=1024*1024;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=x=>JSON.parse(JSON.stringify(x));
const problem=(message,status=422,details)=>Object.assign(new Error(message),
  {status,code:'LEAD_CUSTOMER_REQUEST',...(details?{details}:{})});
const need=(x,message,status=422,details)=>{if(!x)throw problem(message,status,details);};


/** The caller supplies the original validated root. Prepared selections never imply delivery. */
function requestPackageOptions(root,requestId) {
  const original=(root.customer_requests||[]).find(x=>x.id===requestId);
  need(original,'Choose an original customer request.',404);
  const replacements=(root.customer_request_fulfillments||[]).filter(x=>x.request_id===original.id);
  const scopes=new Map([[original.edition_id,{role:'original',fulfillment_id:''}],
    ...replacements.map(x=>[x.edition_id,{role:'replacement',fulfillment_id:x.id}])]);
  const deliveries=(root.deliveries||[]).filter(x=>
    (x.id===original.delivery_id&&x.edition_id===original.edition_id)||replacements.some(r=>r.edition_id===x.edition_id));
  return (root.customer_packages||[]).filter(x=>x.pack_id===original.pack_id&&scopes.has(x.edition_id)).map(packet=>{
    const records=deliveries.filter(x=>x.customer_package_id===packet.id).map(x=>({
      id:x.id,delivered_at:x.delivered_at,channel:x.channel,destination:x.destination,
      provider_id:x.provider_id,receipt_url:x.receipt_url,customer_package_sha256:x.customer_package_sha256
    }));
    return {id:packet.id,sha256:packet.sha256,edition_id:packet.edition_id,edition_sha256:packet.edition_sha256,
      ...scopes.get(packet.edition_id),title:packet.title,prepared_at:packet.prepared_at,
      supersedes:packet.supersedes,files:copy(packet.files),delivery_records:records,
      state:records.length?'delivery_recorded':'prepared'};
  });
}

function createLeadCustomerRequests({hash,sha256Utf8,utf8ByteLength}) {
  need(typeof hash==='function'&&typeof sha256Utf8==='function'&&typeof utf8ByteLength==='function',
    'Use the original complete lead request dependencies.');
  function text(value,label,max=8000,required=false) {
    need(typeof(value??'')==='string',label+' must be text.');
    const result=(value??'').trim();
    need(result.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),
      label+' contains unsupported text.');
    utf8ByteLength(result);need(!required||result,'Enter '+label+'.');return result;
  }
  function id(value,label='record ID') {
    const result=text(value,label,160,true);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result),'Use a stable '+label+'.');return result;
  }
  function instant(value,label,required=true) {
    const result=text(value,label,40,required);if(!result)return '';
    const m=/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.exec(result);
    need(m&&Number(m[2])<24&&Number(m[3])<60&&Number(m[4])<60&&Number.isFinite(Date.parse(result)),
      label+' needs a valid date, time and timezone.');
    need(new Date(m[1]+'T12:00:00Z').toISOString().slice(0,10)===m[1],
      label+' needs a valid calendar date.');
    return new Date(result).toISOString();
  }
  function url(value,label='source link') {
    const result=text(value,label,4000);
    if(!result)return '';
    need(/^https?:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s<>"'\\]*)?$/i.test(result),
      label+' needs a complete HTTP or HTTPS address.');return result;
  }
  const seal=document=>({...document,sha256:hash(document)});
  function checkSeal(row,label) {
    need(plain(row),label+' is incomplete.');id(row.id,label+' ID');
    const {sha256,...document}=row;
    need(sha256===hash(document),label+' changed from its retained complete contents.');
    return row;
  }
  const rows=(root,key)=>root[key]||[];
  const find=(list,value,label)=>{const row=list.find(x=>x.id===value);need(row,'Choose the original '+label+'.',404);return row;};
  function unique(list,label) {
    need(Array.isArray(list),label+' must be a complete list.');
    need(new Set(list.map(x=>x.id)).size===list.length,label+' repeats an original ID.');
  }
  function append(root,key,row) {
    need(!rows(root,key).some(x=>x.id===row.id),'That '+key.replaceAll('_',' ')+' ID is already saved.',409);
    (root[key]??=[]).push(row);return row;
  }
  function request(root,requestId) {return find(rows(root,'customer_requests'),requestId,'customer request');}
  function latestReview(root,requestId) {
    const all=rows(root,'customer_request_reviews').filter(x=>x.request_id===requestId);
    const parents=new Set(all.map(x=>x.previous_id).filter(Boolean));
    const leaves=all.filter(x=>!parents.has(x.id));
    need(leaves.length<=1,'Reconcile the different review branches for this original request.',409);
    return leaves[0]||null;
  }
  function ancestry(root,editionId) {
    const result=[],seen=new Set();let edition=find(root.editions,editionId,'customer edition');
    while(edition){
      need(!seen.has(edition.id),'The original customer edition history contains a cycle.',409);
      seen.add(edition.id);result.push(edition);
      if(!edition.replaces)break;
      const previous=find(root.editions,edition.replaces,'earlier customer edition');
      need(previous.pack_id===edition.pack_id,'The replacement changed customer brief.',409);edition=previous;
    }
    return result;
  }
  function latestEdition(root,editionId) {
    let edition=find(root.editions,editionId,'customer edition');const seen=new Set();
    while(true){
      need(!seen.has(edition.id),'The customer replacement history contains a cycle.',409);seen.add(edition.id);
      const next=root.editions.filter(x=>x.replaces===edition.id);
      need(next.length<=1,'Reconcile the competing customer replacement editions.',409);
      if(!next.length)return edition;
      need(next[0].pack_id===edition.pack_id,'Keep replacements in the original customer brief.',409);edition=next[0];
    }
  }
  function sourceInput(input,packId,at) {
    need(plain(input),'Retain the complete original request source.');
    const kind=input.kind;need(['customer_message','operator_observation'].includes(kind),
      'Identify an original customer message or an operator observation.');
    const format=input.format??'text';need(['text','json'].includes(format),'Retain text or JSON source.');
    need(typeof input.content==='string'&&input.content.length>0,'Retain the complete original source text.');
    const bytes=utf8ByteLength(input.content);
    need(bytes<=MAX_SOURCE_BYTES,'The original source exceeds 1 MiB. Receive its complete source file through the existing document workspace.');
    if(format==='json'){try{JSON.parse(input.content.replace(/^\uFEFF/,''));}catch{throw problem('The declared original JSON source is incomplete.');}}
    const occurredAt=instant(input.occurred_at,'original source time'),capturedAt=instant(input.captured_at??at,'source recording time');
    need(Date.parse(occurredAt)<=Date.parse(capturedAt)&&Date.parse(capturedAt)<=Date.parse(at),'Record source times already observed in their actual order.');
    return seal({id:id(input.id,'source ID'),pack_id:packId,kind,
      channel:text(input.channel,'source channel',120,true),
      provider_id:text(input.provider_id,'original message or source reference',500,true),
      author:text(input.author,'customer or observing operator',500,true),
      occurred_at:occurredAt,captured_at:capturedAt,
      reference_url:url(input.reference_url),format,content:input.content,
      bytes,content_sha256:sha256Utf8(input.content).sha256});
  }
  function recordSource(root,source) {
    const original=rows(root,'customer_request_sources').find(x=>x.id===source.id);
    if(original){need(hash(original)===hash(source),'This source ID already retains different original bytes.',409);return original;}
    return append(root,'customer_request_sources',source);
  }
  function intake(root,input,at) {
    const packId=id(input.pack_id,'customer brief ID'),pack=find(root.packs,packId,'customer brief');
    const edition=find(root.editions,id(input.edition_id,'customer edition ID'),'customer edition');
    need(edition.pack_id===packId&&edition.sha256===input.expected_edition_sha256,
      'Select the exact original customer edition.',409);
    const source=sourceInput(input.source,packId,at);
    let delivery=null;
    if(input.delivery_id){
      delivery=find(root.deliveries,id(input.delivery_id,'original delivery ID'),'recorded delivery');
      need(delivery.edition_id===edition.id&&hash(delivery)===input.expected_delivery_sha256,
        'Select the actual delivery of this exact customer edition.',409);
      need(Date.parse(source.occurred_at)>=Date.parse(delivery.delivered_at),
        'The customer request source precedes the selected recorded delivery.');
    }
    need(source.kind!=='customer_message'||delivery,
      'Select the actual saved delivery before recording customer feedback. Use operator observation for your own pre-delivery review.');
    const kind=source.kind==='customer_message'?'customer_request':'operator_review';
    need(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=edition.leads.length,
      'Identify the affected leads in the selected complete edition.');
    const seen=new Set();
    const items=input.items.map(value=>{
      need(plain(value),'Each reported issue must be complete.');
      const lead=find(edition.leads,id(value.lead_id,'original lead ID'),'lead in that edition');
      need(!seen.has(lead.id),'Describe each original lead once in this request.');seen.add(lead.id);
      need(CATEGORIES.includes(value.category),'Choose the reported issue category.');
      return {id:id(value.id,'request item ID'),lead_id:lead.id,lead_revision:lead.revision,
        lead_sha256:lead.sha256,category:value.category,
        statement:text(value.statement,'reported issue',8000,true),
        requested_remedy:text(value.requested_remedy,'requested correction',4000)};
    });
    unique(items,'Request items');
    let previous=null;
    if(input.previous_request_id){
      previous=request(root,id(input.previous_request_id,'earlier request ID'));
      need(previous.pack_id===packId&&previous.sha256===input.expected_previous_request_sha256,
        'Keep the follow-up bound to its complete original request.',409);
    }
    const requestId=id(input.id,'customer request ID');
    need(!rows(root,'customer_requests').some(x=>x.id===requestId),'This request ID is already saved.',409);
    const repeated=rows(root,'customer_requests').find(x=>x.pack_id===packId&&x.edition_id===edition.id&&
      x.source_id===source.id&&hash(x.items)===hash(items));
    need(!repeated,'The same original request and lead selection are already recorded. Open that request.',409,
      repeated?{request_id:repeated.id}:undefined);
    recordSource(root,source);
    const value=append(root,'customer_requests',seal({
      id:requestId,version:VERSION,pack_id:packId,pack_revision:pack.revision,pack_sha256:pack.sha256,kind,
      edition_id:edition.id,edition_sha256:edition.sha256,
      delivery_id:delivery?.id||'',delivery_sha256:delivery?hash(delivery):'',
      source_id:source.id,source_sha256:source.sha256,
      received_at:source.occurred_at,recorded_at:at,
      actor:text(input.actor,'recording operator',500,true),
      title:text(input.title,'request title',300,true),items,
      case_id:edition.brief.customer.case_id||pack.document.customer.case_id||'',
      previous_request_id:previous?.id||'',previous_request_sha256:previous?.sha256||'',
      note:text(input.note,'internal request note',12000)
    }));
    return {pack_id:packId,request_id:value.id,request_sha256:value.sha256,
      edition_id:edition.id,delivery_id:delivery?.id||'',case_id:value.case_id};
  }
  function review(root,input,at) {
    const original=request(root,id(input.request_id,'customer request ID'));
    need(original.sha256===input.expected_request_sha256,'Reopen the complete original customer request.',409);
    const previous=latestReview(root,original.id);
    need((input.previous_review_id||'')===(previous?.id||'')&&
      (input.expected_previous_review_sha256||'')===(previous?.sha256||''),
      'Review the latest saved decision before recording another revision.',409);
    need(Array.isArray(input.decisions)&&input.decisions.length===original.items.length,
      'Record a decision for every item in this request.');
    const used=new Set();
    const decisions=input.decisions.map(value=>{
      need(plain(value),'Each review decision must be complete.');
      const item=find(original.items,id(value.item_id,'request item ID'),'reported item');
      need(!used.has(item.id),'Review each reported item once.');used.add(item.id);
      need(DECISIONS.includes(value.decision),'Choose replace, decline, needs information or resolved.');
      const evidence=value.evidence||[];
      need(Array.isArray(evidence)&&evidence.length<=30,'Keep the complete supporting evidence references.');
      const decision={item_id:item.id,decision:value.decision,
        reason:text(value.reason,'review reason',8000,true),
        evidence:evidence.map(x=>({label:text(x.label,'evidence label',500,true),
          url:url(x.url,'review source link'),note:text(x.note,'source observation',8000),
          source_id:x.source_id?id(x.source_id,'retained source ID'):''}))};
      for(const ref of decision.evidence)if(ref.source_id){
        const source=find(rows(root,'customer_request_sources'),ref.source_id,'retained request source');
        need(source.pack_id===original.pack_id,'Keep the review source with the same customer.');
      }
      const completed=rows(root,'customer_request_fulfillments').some(x=>x.request_id===original.id&&x.mappings.some(m=>m.item_id===item.id));
      if(completed){
        const prior=previous?.decisions.find(x=>x.item_id===item.id);
        need(prior&&hash(prior)===hash(decision),
          'This decision already produced a customer edition. Preserve it and open a follow-up request for that later edition.',409);
      }
      return decision;
    });
    const row=append(root,'customer_request_reviews',seal({
      id:id(input.id,'review ID'),request_id:original.id,request_sha256:original.sha256,
      pack_id:original.pack_id,previous_id:previous?.id||'',previous_sha256:previous?.sha256||'',
      reviewed_at:at,actor:text(input.actor,'reviewing operator',500,true),
      decisions:original.items.map(item=>decisions.find(x=>x.item_id===item.id)),
      note:text(input.note,'internal review note',12000)
    }));
    return {pack_id:original.pack_id,request_id:original.id,review_id:row.id,review_sha256:row.sha256,
      approved:row.decisions.filter(x=>x.decision==='replace').length,case_id:original.case_id};
  }
  function replacementPlan(root,input) {
    const original=request(root,id(input.request_id,'customer request ID'));
    need(original.sha256===input.expected_request_sha256,'Reopen the original customer request.',409);
    const review=latestReview(root,original.id);
    need(review&&review.id===input.review_id&&review.sha256===input.expected_review_sha256,
      'Use the current complete review for this replacement.',409);
    const base=latestEdition(root,original.edition_id);
    need(base.kind!=='sample','A free sample keeps its existing preparation path. Record its issue and prepare a new free sample explicitly from additional inventory.');
    need(base.id===input.base_edition_id&&base.sha256===input.expected_base_edition_sha256,
      'Choose the latest original paid or replacement edition.',409);
    need(!root.withdrawals.some(x=>x.edition_id===base.id),'The selected customer edition was withdrawn.',409);
    need(Array.isArray(input.mappings)&&input.mappings.length>0,'Select the approved issues to fulfill.');
    const used=new Set(),mappings=input.mappings.map(value=>{
      need(plain(value),'Each replacement choice must be complete.');
      const item=find(original.items,id(value.item_id,'request item ID'),'request item');
      need(!used.has(item.id),'Fulfill each approved item once.');used.add(item.id);
      const decision=review.decisions.find(x=>x.item_id===item.id);
      need(decision?.decision==='replace','Only the items explicitly reviewed for replacement can enter this preparation.');
      need(!rows(root,'customer_request_fulfillments').some(x=>x.request_id===original.id&&x.mappings.some(m=>m.item_id===item.id)),
        'This original issue already has a prepared replacement. Open that edition.',409);
      const lead=base.leads.find(x=>x.id===item.lead_id&&x.revision===item.lead_revision&&x.sha256===item.lead_sha256);
      need(lead,'This reported original lead is no longer in the latest edition. Review its existing correction instead of replacing another lead.',409);
      return {item_id:item.id,old_id:item.lead_id,new_id:id(value.new_id,'replacement lead ID'),
        reason:decision.reason};
    });
    return {original,review,base,mappings};
  }
  function fulfill(root,input,at,prepareEdition) {
    need(typeof prepareEdition==='function','Use the original customer edition engine.');
    const plan=replacementPlan(root,input),fulfillmentId=id(input.id,'fulfillment ID');
    need(!rows(root,'customer_request_fulfillments').some(x=>x.id===fulfillmentId),'This fulfillment ID is already saved.',409);
    const editionId=id(input.edition_id,'new replacement edition ID');
    const edition=prepareEdition({pack_id:plan.original.pack_id,id:editionId,kind:'replacement',
      replaces:plan.base.id,replacements:plan.mappings.map(({old_id,new_id,reason})=>({old_id,new_id,reason}))});
    const row=append(root,'customer_request_fulfillments',seal({
      id:fulfillmentId,pack_id:plan.original.pack_id,request_id:plan.original.id,
      request_sha256:plan.original.sha256,review_id:plan.review.id,review_sha256:plan.review.sha256,
      base_edition_id:plan.base.id,base_edition_sha256:plan.base.sha256,
      edition_id:edition.id,edition_sha256:edition.sha256,
      mappings:plan.mappings,prepared_at:at,actor:text(input.actor,'preparing operator',500,true),
      note:text(input.note,'internal fulfillment note',12000)
    }));
    return {pack_id:plan.original.pack_id,request_id:plan.original.id,review_id:plan.review.id,
      fulfillment_id:row.id,edition_id:edition.id,edition_sha256:edition.sha256,
      lead_count:edition.leads.length,case_id:plan.original.case_id};
  }
  function validate(root) {
    for(const key of FIELDS){
      need(root[key]===undefined||Array.isArray(root[key]),'The complete saved '+key+' list is missing.');
      unique(rows(root,key),key);
      for(const row of rows(root,key))checkSeal(row,key);
    }
    const packs=new Set(root.packs.map(x=>x.id));
    for(const row of rows(root,'customer_request_sources')){
      need(packs.has(row.pack_id),'The original request source lost its customer brief.');
      need(['customer_message','operator_observation'].includes(row.kind)&&['text','json'].includes(row.format),
        'The original request source kind or format changed.');
      need(typeof row.content==='string'&&row.content.length>0&&
        row.bytes===utf8ByteLength(row.content)&&row.bytes<=MAX_SOURCE_BYTES&&
        row.content_sha256===sha256Utf8(row.content).sha256,
        'The complete original request source bytes changed.');
      if(row.format==='json'){try{JSON.parse(row.content.replace(/^\uFEFF/,''));}catch{throw problem('The original request JSON is incomplete.');}}
      instant(row.occurred_at,'original request time');instant(row.captured_at,'source capture time');
      need(Date.parse(row.occurred_at)<=Date.parse(row.captured_at),'The source capture precedes its original occurrence.');
      text(row.author,'source author',500,true);text(row.provider_id,'original source reference',500,true);
      text(row.channel,'source channel',120,true);url(row.reference_url);
    }
    for(const row of rows(root,'customer_requests')){
      need(row.version===VERSION&&packs.has(row.pack_id),'The customer request lost its original brief.');
      const pack=find(root.packs,row.pack_id,'customer brief');
      const packVersion=[...pack.history,pack].find(x=>x.revision===row.pack_revision);
      need(packVersion&&packVersion.sha256===row.pack_sha256,'The request lost its selected customer brief revision.');
      text(row.title,'request title',300,true);text(row.note,'internal request note',12000);
      const edition=find(root.editions,row.edition_id,'request edition');
      need(edition.pack_id===row.pack_id&&edition.sha256===row.edition_sha256,'The request edition identity changed.');
      need(row.case_id===(edition.brief.customer.case_id||packVersion.document.customer.case_id||''),'The request case association differs from its original customer records.');
      const source=find(rows(root,'customer_request_sources'),row.source_id,'complete request source');
      need(source.pack_id===row.pack_id&&source.sha256===row.source_sha256&&source.occurred_at===row.received_at,
        'The request lost its complete original source.');
      need(row.kind===(source.kind==='customer_message'?'customer_request':'operator_review'),
        'A recorded operator observation cannot become a customer statement.');
      instant(row.recorded_at,'request recording time');text(row.actor,'recording operator',500,true);
      need(Date.parse(row.received_at)<=Date.parse(source.captured_at)&&Date.parse(source.captured_at)<=Date.parse(row.recorded_at),
        'The request source and capture times must precede its recording in their original order.');
      if(row.delivery_id){
        const delivery=find(root.deliveries,row.delivery_id,'original request delivery');
        need(delivery.edition_id===edition.id&&hash(delivery)===row.delivery_sha256&&
          Date.parse(delivery.delivered_at)<=Date.parse(row.received_at),'The request delivery changed or follows its source.');
      }else need(row.kind==='operator_review'&&!row.delivery_sha256,'A customer message needs its actual recorded delivery.');
      need(Array.isArray(row.items)&&row.items.length>0&&row.items.length<=edition.leads.length,
        'The request must retain its whole affected-lead selection.');
      unique(row.items,'Request items');const leadIds=new Set();
      for(const item of row.items){
        id(item.id,'item ID');const lead=find(edition.leads,item.lead_id,'reported original lead');
        need(lead.revision===item.lead_revision&&lead.sha256===item.lead_sha256&&!leadIds.has(lead.id),
          'The reported lead no longer matches its original frozen selection.');leadIds.add(lead.id);
        need(CATEGORIES.includes(item.category),'The reported issue category changed.');
        text(item.statement,'reported issue',8000,true);text(item.requested_remedy,'requested remedy',4000);
      }
      if(row.previous_request_id){
        const previous=find(rows(root,'customer_requests'),row.previous_request_id,'earlier request');
        need(previous.id!==row.id&&previous.pack_id===row.pack_id&&previous.sha256===row.previous_request_sha256&&
          Date.parse(previous.recorded_at)<=Date.parse(row.recorded_at),'The follow-up lost its original request.');
        const seen=new Set([row.id]);let current=previous;
        while(current){need(!seen.has(current.id),'The request history contains a cycle.');seen.add(current.id);
          current=current.previous_request_id?find(rows(root,'customer_requests'),current.previous_request_id,'earlier request'):null;}
      }else need(!row.previous_request_sha256,'The earlier request identity is incomplete.');
    }
    const reviewChildren=new Map();
    for(const row of rows(root,'customer_request_reviews')){
      const original=request(root,row.request_id);
      need(row.pack_id===original.pack_id&&row.request_sha256===original.sha256,'A review lost its original request.');
      instant(row.reviewed_at,'review time');text(row.actor,'reviewing operator',500,true);
      need(Date.parse(row.reviewed_at)>=Date.parse(original.recorded_at),'The review precedes its request.');
      need(Array.isArray(row.decisions)&&row.decisions.length===original.items.length,
        'The saved review does not cover every original item.');
      const used=new Set();
      for(const decision of row.decisions){
        const item=find(original.items,decision.item_id,'reviewed request item');
        need(!used.has(item.id)&&DECISIONS.includes(decision.decision),'The review repeats an item or has an unsupported decision.');used.add(item.id);
        text(decision.reason,'review reason',8000,true);
        need(Array.isArray(decision.evidence)&&decision.evidence.length<=30,'The complete review sources are missing.');
        for(const ref of decision.evidence){
          text(ref.label,'evidence label',500,true);url(ref.url);text(ref.note,'source observation',8000);
          if(ref.source_id)need(find(rows(root,'customer_request_sources'),ref.source_id,'review source').pack_id===original.pack_id,
            'The review refers to another customer source.');
        }
      }
      const branch=row.request_id+':'+(row.previous_id||'');
      need(!reviewChildren.has(branch),'The working records contain competing customer review revisions.',409);
      reviewChildren.set(branch,row.id);
      if(row.previous_id){
        const previous=find(rows(root,'customer_request_reviews'),row.previous_id,'earlier review');
        need(previous.id!==row.id&&previous.request_id===row.request_id&&previous.sha256===row.previous_sha256&&
          Date.parse(previous.reviewed_at)<=Date.parse(row.reviewed_at),'The review lost its earlier complete revision.');
        const seen=new Set([row.id]);let cursor=previous;
        while(cursor){need(!seen.has(cursor.id),'The review history contains a cycle.');seen.add(cursor.id);
          cursor=cursor.previous_id?find(rows(root,'customer_request_reviews'),cursor.previous_id,'earlier review'):null;}
      }else need(!row.previous_sha256,'The previous review identity is incomplete.');
    }
    const fulfilled=new Set(),editions=new Set();
    for(const row of rows(root,'customer_request_fulfillments')){
      const original=request(root,row.request_id),review=find(rows(root,'customer_request_reviews'),row.review_id,'fulfillment review');
      const base=find(root.editions,row.base_edition_id,'original replacement base'),edition=find(root.editions,row.edition_id,'prepared replacement');
      need(row.pack_id===original.pack_id&&row.request_sha256===original.sha256&&
        review.request_id===original.id&&review.sha256===row.review_sha256,'The correction lost its original reviewed request.');
      need(base.pack_id===original.pack_id&&base.sha256===row.base_edition_sha256&&
        ancestry(root,base.id).some(x=>x.id===original.edition_id)&&
        edition.replaces===base.id&&edition.sha256===row.edition_sha256&&edition.pack_id===original.pack_id&&
        edition.kind==='replacement','The correction lost its original customer edition lineage.');
      need(!editions.has(edition.id),'A prepared correction belongs to multiple requests.');editions.add(edition.id);
      need(Array.isArray(row.mappings)&&row.mappings.length>0&&row.mappings.length===edition.replacements.length,
        'The complete issue-to-replacement mapping changed.');
      for(const mapping of row.mappings){
        const item=find(original.items,mapping.item_id,'fulfilled item'),key=original.id+':'+item.id;
        need(!fulfilled.has(key),'The same reported issue has competing replacement fulfillments.',409);fulfilled.add(key);
        const decision=review.decisions.find(x=>x.item_id===item.id);
        const originalLead=base.leads.find(x=>x.id===item.lead_id&&x.revision===item.lead_revision&&x.sha256===item.lead_sha256);
        need(decision?.decision==='replace'&&originalLead&&mapping.old_id===item.lead_id&&mapping.reason===decision.reason&&
          edition.replacements.some(x=>hash(x)===hash({old_id:mapping.old_id,new_id:mapping.new_id,reason:mapping.reason})),
          'The prepared change differs from the actual approved original issue.');
        // Later reviews retain every decision that has already produced a correction.
        let later=review;
        while(true){const child=rows(root,'customer_request_reviews').find(x=>x.previous_id===later.id);if(!child)break;
          need(hash(child.decisions.find(x=>x.item_id===item.id))===hash(decision),
            'A later review rewrote an already fulfilled decision.');later=child;}
      }
      instant(row.prepared_at,'correction preparation time');text(row.actor,'preparing operator',500,true);
      need(row.prepared_at===edition.prepared_at&&Date.parse(row.prepared_at)>=Date.parse(review.reviewed_at),
        'The correction preparation time differs from its edition or review.');
    }
    return root;
  }
  function forPack(root,packId) {
    return Object.fromEntries(FIELDS.filter(key=>root[key]!==undefined)
      .map(key=>[key,copy(rows(root,key).filter(row=>row.pack_id===packId))]));
  }
  function merge(root,bundle,report) {
    for(const key of FIELDS)for(const row of bundle[key]||[]){
      const existing=rows(root,key).find(x=>x.id===row.id);
      if(!existing){
        (root[key]??=[]).push(copy(row));report.added[key]=(report.added[key]||0)+1;
        report.records.push({entity:key,id:row.id,name:row.title||row.id,action:'add'});
      }else if(hash(existing)!==hash(row)){
        report.conflicts.push({entity:key,id:row.id,reason:'The original complete customer request history has different contents.'});
      }else report.unchanged++;
    }
    try{validate(root);}catch(error){
      report.conflicts.push({entity:'customer_requests',id:bundle.pack?.id||'workspace',reason:error.message});
    }
  }
  function view(root,packId='') {
    return rows(root,'customer_requests').filter(x=>!packId||x.pack_id===packId).map(original=>{
      const source=find(rows(root,'customer_request_sources'),original.source_id,'request source');
      const review=latestReview(root,original.id),base=latestEdition(root,original.edition_id);
      const fulfillments=rows(root,'customer_request_fulfillments').filter(x=>x.request_id===original.id);
      const items=original.items.map(item=>{
        const decision=review?.decisions.find(x=>x.item_id===item.id)||null;
        const fulfillment=fulfillments.find(x=>x.mappings.some(m=>m.item_id===item.id))||null;
        const mapping=fulfillment?.mappings.find(m=>m.item_id===item.id)||null;
        const deliveries=fulfillment?root.deliveries.filter(x=>x.edition_id===fulfillment.edition_id):[];
        const available=base.kind!=='sample'&&!root.withdrawals.some(x=>x.edition_id===base.id)&&
          base.leads.some(x=>x.id===item.lead_id&&x.revision===item.lead_revision&&x.sha256===item.lead_sha256);
        return {...copy(item),decision:copy(decision),fulfillment:fulfillment?copy(fulfillment):null,
          replacement_lead_id:mapping?.new_id||'',deliveries:copy(deliveries),
          state:fulfillment?(deliveries.length?'delivery_recorded':'replacement_prepared'):
            decision?.decision==='replace'?(available?'ready_to_replace':'needs_current_edition_review'):
            decision?.decision||'awaiting_review'};
      });
      const {content,...sourceSummary}=source,packages=requestPackageOptions(root,original.id);
      return {...copy(original),source:copy(sourceSummary),review:copy(review),
        review_history:copy(rows(root,'customer_request_reviews').filter(x=>x.request_id===original.id)),
        current_edition:{id:base.id,sha256:base.sha256,kind:base.kind},
        items,fulfillments:copy(fulfillments),...(packages.length?{customer_packages:packages}:{}),
        case_url:original.case_id?'/case?case_id='+encodeURIComponent(original.case_id):'',
        counts:Object.fromEntries(['awaiting_review','replace','decline','needs_information','resolved',
          'ready_to_replace','needs_current_edition_review','replacement_prepared','delivery_recorded'].map(status=>
          [status,items.filter(x=>x.state===status).length]))};
    });
  }
  function apply(root,kind,input,at,prepareEdition) {
    if(kind==='customer-request-receive')return intake(root,input,at);
    if(kind==='customer-request-review')return review(root,input,at);
    if(kind==='customer-request-replace')return fulfill(root,input,at,prepareEdition);
    throw problem('Choose a supported customer request operation.');
  }
  function customerReport(root,requestId) {
    const original=request(root,requestId),selected=view(root,original.pack_id).find(x=>x.id===original.id);
    const edition=find(root.editions,original.edition_id,'original customer edition');
    const latest=selected.review,packages=requestPackageOptions(root,original.id).filter(x=>x.delivery_records.length);
    return {version:'dealscout.lead-customer-resolution.v1',
      request_id:original.id,request_sha256:original.sha256,
      title:original.title,record_kind:original.kind,customer:{name:edition.brief.customer.name,company_domain:edition.brief.customer.company_domain},
      original_edition_id:edition.id,original_edition_sha256:edition.sha256,
      original_delivery_id:original.delivery_id,received_at:original.received_at,
      reviewed_at:latest?.reviewed_at||'',review_id:latest?.id||'',
      ...(packages.length?{customer_packages:packages}:{}),
      items:selected.items.map(item=>({
        item_id:item.id,lead_id:item.lead_id,
        organization:edition.leads.find(x=>x.id===item.lead_id)?.document.organization||item.lead_id,
        reported_issue:item.statement,requested_remedy:item.requested_remedy,
        decision:item.decision?.decision||'awaiting_review',reason:item.decision?.reason||'',
        supporting_sources:copy(item.decision?.evidence||[]).map(({label,url,note})=>({label,url,note})),
        state:item.state,replacement_edition_id:item.fulfillment?.edition_id||'',
        replacement_lead_id:item.replacement_lead_id,
        delivery_records:item.deliveries.map(x=>({id:x.id,delivered_at:x.delivered_at,channel:x.channel,
          destination:x.destination,provider_id:x.provider_id,receipt_url:x.receipt_url}))
      })),
      replacements:selected.fulfillments.map(x=>({id:x.id,edition_id:x.edition_id,
        edition_sha256:x.edition_sha256,base_edition_id:x.base_edition_id,
        prepared_at:x.prepared_at,mappings:copy(x.mappings)}))
    };
  }
  return Object.freeze({VERSION,FIELDS,CATEGORIES,DECISIONS,MAX_SOURCE_BYTES,validate,forPack,merge,view,
    apply,latestReview,latestEdition,replacementPlan,customerReport});
}
module.exports={VERSION,FIELDS,CATEGORIES,DECISIONS,MAX_SOURCE_BYTES,requestPackageOptions,createLeadCustomerRequests};
