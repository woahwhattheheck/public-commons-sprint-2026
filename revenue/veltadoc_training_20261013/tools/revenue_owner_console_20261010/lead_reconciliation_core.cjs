'use strict';
/** Retained branch sources and explicit reconciliation in the original lead workspace. */
const VERSION='dealscout.lead-reconciliation-source.v1';
const REVIEW='dealscout.lead-reconciliation-review.v1';
const PREVIEW='dealscout.lead-reconciliation-preview.v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const problem=(message,status=422,details)=>Object.assign(new Error(message),{status,code:'LEAD_RECONCILIATION',...(details?{details}:{})});
const need=(v,message,status=422,details)=>{if(!v)throw problem(message,status,details);};
function text(v,label,max=4000,required=false){
  need(typeof(v??'')==='string',label+' must be text.');const s=(v??'').trim();
  need(s.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)&&(!required||s),'Enter '+label+'.');return s;
}
function id(v,label='record ID'){const s=text(v,label,160,true);need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s),'Use a valid '+label+'.');return s;}
function instant(v){need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'Retain the original normalized operation time.');return v;}
function find(rows,value,label){const row=rows.find(r=>r.id===value);need(row,'Choose an existing '+label+'.',404);return row;}
const seal=(document,api)=>({...document,sha256:api.hash(document)});
function verified(row,version,api){
  need(plain(row)&&row.version===version,'The retained reconciliation record is incomplete.');
  const {sha256,...document}=row;need(sha256===api.hash(document),'The retained reconciliation source or review changed.');id(row.id);id(row.pack_id,'pack ID');
}
const sources=root=>root.reconciliation_sources||[];
const reviews=root=>root.reconciliation_reviews||[];
const values=row=>[...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,updated_at:row.updated_at}];
function commonVersion(current,incoming,api){
  if(!current||current.id!==incoming.id)return null;
  const a=values(current),b=values(incoming);let common=null;
  for(let i=0;i<Math.min(a.length,b.length);i++){if(api.hash(a[i])!==api.hash(b[i]))break;common=a[i];}
  return common;
}
function fields(document){
  const out={};for(const [key,value]of Object.entries(document)){
    if(plain(value))for(const [sub,item]of Object.entries(value))out[key+'.'+sub]=item;
    else out[key]=value;
  }return out;
}
function compare(current,incoming,api){
  const base=commonVersion(current,incoming,api),a=fields(current?.document||{}),b=fields(incoming.document),c=fields(base?.document||{});
  return {common_revision:base?.revision??null,current_revision:current?.revision??null,incoming_revision:incoming.revision,
    identical:Boolean(current&&api.hash(current)===api.hash(incoming)),
    fields:Object.keys(b).filter(path=>api.hash(a[path]??null)!==api.hash(b[path])).map(path=>({
      path,current:a[path]??null,incoming:b[path],base:Object.prototype.hasOwnProperty.call(c,path)?c[path]:null,
      current_changed:base?api.hash(a[path])!==api.hash(c[path]):null,
      incoming_changed:base?api.hash(b[path])!==api.hash(c[path]):null
    }))};
}
function selectedFields(current,incoming,selection,api,normalize){
  need(Array.isArray(selection)&&new Set(selection).size===selection.length,'Choose each incoming field once.');
  const allowed=fields(incoming),result=clone(current);
  for(const path of selection){
    need(typeof path==='string'&&Object.prototype.hasOwnProperty.call(allowed,path),'Choose a field from this complete incoming record.');
    const parts=path.split('.');
    if(parts.length===1)result[parts[0]]=clone(allowed[path]);
    else result[parts[0]][parts[1]]=clone(allowed[path]);
  }
  return normalize(result);
}
const ASSETS=['editions','deliveries','withdrawals','commercial_links','commercial_deliveries','delivery_feedback_sources','delivery_feedback','capture_plans','capture_results','capture_reviews'];
function assetRows(root,key){
  if(key.startsWith('capture_'))return root.captures?.[key.slice(8)]||[];
  return root[key]||[];
}
function setAssetRows(root,key,rows){
  if(key.startsWith('capture_')){root.captures??={version:'dealscout.lead-captures.v1',plans:[],results:[],reviews:[]};root.captures[key.slice(8)]=rows;}
  else root[key]=rows;
}
function sourceAssetRows(bundle,key){
  if(key.startsWith('capture_'))return bundle.captures?.[key.slice(8)]||[];
  return bundle[key]||[];
}
function validate(root,api){
  for(const key of ['reconciliation_sources','reconciliation_reviews']){
    need(root[key]===undefined||Array.isArray(root[key]),'The retained reconciliation list is incomplete.');
    const rows=root[key]||[];need(rows.every(plain),'The retained reconciliation list contains an incomplete record.');need(new Set(rows.map(r=>r.id)).size===rows.length,'The retained reconciliation list repeats an ID.');
  }
  for(const row of sources(root)){
    verified(row,VERSION,api);instant(row.received_at);text(row.note,'source note',4000);
    need(root.packs.some(p=>p.id===row.pack_id),'The retained source lost its original customer.');
    need(row.source?.pack?.id===row.pack_id&&row.baseline?.pack?.id===row.pack_id,'The two branch sources belong to different customer cases.');
    api.validateBundle(row.source);api.validateBundle(row.baseline);
    need(row.baseline.reconciliation_sources===undefined&&row.baseline.reconciliation_reviews===undefined,
      'The baseline retains the customer records directly; previous reconciliation sources stay in their original store.');
  }
  const seen=new Set();
  for(const row of reviews(root)){
    verified(row,REVIEW,api);instant(row.reviewed_at);text(row.reason,'review reason',4000,true);
    const source=find(sources(root),row.source_id,'retained source');
    need(source.pack_id===row.pack_id&&source.sha256===row.source_sha256,'The review lost its original source.');
    need(!seen.has(row.source_id),'This source already has a completed reconciliation.');seen.add(row.source_id);
    need(/^[a-f0-9]{64}$/.test(row.canonical_before_sha256)&&/^[a-f0-9]{64}$/.test(row.canonical_after_sha256)&&plain(row.choices)&&Array.isArray(row.applied)&&Array.isArray(row.assets),
      'The complete reconciliation choices and result are missing.');
    for(const applied of row.applied){
      need(plain(applied)&&['brief','lead'].includes(applied.entity),'The reviewed record type is invalid.');
      const target=find(applied.entity==='brief'?root.packs:root.leads,applied.target_id,'reviewed current record');
      need((applied.entity==='brief'?target.id:target.pack_id)===row.pack_id,'The reviewed record belongs to another customer.');
      const version=values(target).find(v=>v.revision===applied.after_revision);
      need(version&&version.sha256===applied.after_sha256&&version.updated_at===applied.updated_at,'The reviewed current revision has changed.');
    }
    const assetKeys=new Set();
    for(const asset of row.assets){
      need(plain(asset)&&ASSETS.includes(asset.entity)&&typeof asset.added==='boolean'&&typeof asset.sha256==='string',
        'The reviewed asset identity is incomplete.');
      id(asset.id,'reviewed asset ID');const key=asset.entity+':'+asset.id;
      need(!assetKeys.has(key),'The completed review repeats an original asset.');assetKeys.add(key);
      const original=find(sourceAssetRows(source.source,asset.entity),asset.id,'reviewed original source asset');
      const current=find(assetRows(root,asset.entity),asset.id,'reviewed current asset');
      need(api.hash(original)===asset.sha256&&api.hash(current)===asset.sha256,
        'The reviewed original asset has changed or lost its complete current copy.');
    }
  }
}
function list(root,packId){
  return sources(root).filter(row=>row.pack_id===packId).map(row=>{
    const review=reviews(root).find(r=>r.source_id===row.id);
    return {id:row.id,sha256:row.sha256,received_at:row.received_at,note:row.note,
      incoming_sha256:row.source.sha256,baseline_sha256:row.baseline.sha256,
      incoming_leads:row.source.leads.length,incoming_editions:row.source.editions.length,
      review:review?{id:review.id,reviewed_at:review.reviewed_at,reason:review.reason,changed_records:review.applied.filter(a=>a.changed).length}:null};
  });
}
function stage(root,input,at,api){
  need(plain(input),'Supply the complete branch source.');id(input.id,'source ID');api.validateBundle(input.bundle);
  const packId=input.bundle.pack.id;find(root.packs,packId,'current customer brief');
  need(!sources(root).some(r=>r.id===input.id),'This source ID already has retained work. Resume its original operation.',409);
  const same=sources(root).find(r=>r.pack_id===packId&&r.source.sha256===input.bundle.sha256&&!reviews(root).some(v=>v.source_id===r.id));
  if(same)return {pack_id:packId,reconciliation_source_id:same.id,retained:true,existing:true};
  const row=seal({version:VERSION,id:input.id,pack_id:packId,received_at:at,note:text(input.note,'source note',4000),
    baseline:api.workingRecord(root,packId),source:clone(input.bundle)},api);
  (root.reconciliation_sources??=[]).push(row);
  return {pack_id:packId,reconciliation_source_id:row.id,source_sha256:row.sha256,retained:true};
}
function defaultChoices(root,source,api){
  const own=root.leads.filter(r=>r.pack_id===source.pack_id);
  return {brief_fields:[],leads:source.source.leads.map(row=>{
    const same=own.find(r=>r.id===row.id),matches=own.filter(r=>api.keys(row.document).some(k=>api.keys(r.document).includes(k)));
    if(same)return {incoming_id:row.id,target_id:same.id,action:'keep',fields:[]};
    if(matches.length===1)return {incoming_id:row.id,target_id:matches[0].id,action:'keep',fields:[]};
    if(matches.length>1)return {incoming_id:row.id,target_id:'',action:'retain',fields:[]};
    return {incoming_id:row.id,target_id:row.id,action:'add',fields:[]};
  }),assets:Object.fromEntries(ASSETS.map(key=>[key,[]]))};
}
function plan(root,source,choices,at,api){
  need(plain(choices)&&Array.isArray(choices.leads)&&choices.leads.every(plain)&&plain(choices.assets),'Review the complete brief, company mapping and original assets.');
  need(Object.keys(choices).every(k=>['brief_fields','leads','assets'].includes(k))&&Object.keys(choices.assets).every(k=>ASSETS.includes(k)),'The review contains unsupported choices.');
  const candidate=clone(root),packId=source.pack_id,pack=find(candidate.packs,packId,'current brief'),applied=[],assets=[];
  const before=api.workingRecord(root,packId).sha256;
  const changedPack=api.revision(candidate.packs,packId,selectedFields(pack.document,source.source.pack.document,choices.brief_fields,api,api.normalizePack),at);
  applied.push({entity:'brief',source_id:source.source.pack.id,target_id:packId,before_revision:pack.revision,after_revision:changedPack.revision,
    after_sha256:changedPack.sha256,updated_at:changedPack.updated_at,changed:changedPack.revision!==pack.revision});
  need(choices.leads.length===source.source.leads.length&&new Set(choices.leads.map(r=>r.incoming_id)).size===choices.leads.length,
    'Choose how to handle every original incoming company exactly once.');
  const targets=new Set();
  for(const choice of choices.leads){
    need(plain(choice)&&Object.keys(choice).every(k=>['incoming_id','target_id','action','fields'].includes(k)),'Use the supported company mapping fields.');
    const incoming=find(source.source.leads,id(choice.incoming_id,'incoming lead ID'),'incoming company');
    need(['keep','update','add','retain'].includes(choice.action),'Choose keep current, use selected fields, add original company, or retain in source.');
    need(Array.isArray(choice.fields),'Choose the incoming company fields.');
    if(choice.action==='retain'){need(!choice.target_id&&!choice.fields.length,'A source-only company has no current target or applied fields.');continue;}
    const targetId=id(choice.target_id,'current lead ID');need(!targets.has(targetId),'Two incoming records target the same current company. Retain one in the source or reconcile it separately.');targets.add(targetId);
    const target=candidate.leads.find(r=>r.id===targetId);
    if(choice.action==='add'){
      need(targetId===incoming.id&&!target,'Add an unused original incoming ID. Map an existing company to its current record.',409);
      need(!choice.fields.length,'An added original company retains its complete incoming document and history.');
      const duplicate=candidate.leads.find(r=>r.pack_id===packId&&api.keys(r.document).some(k=>api.keys(incoming.document).includes(k)));
      need(!duplicate,'This company or request already has a current record. Select its existing ID.',409,duplicate?[{id:incoming.id,other_id:duplicate.id,reason:'Map this incoming company to its current record.'}]:undefined);
      candidate.leads.push(clone(incoming));
      applied.push({entity:'lead',source_id:incoming.id,target_id:incoming.id,before_revision:0,after_revision:incoming.revision,
        after_sha256:incoming.sha256,updated_at:incoming.updated_at,changed:true});continue;
    }
    need(target&&target.pack_id===packId,'Choose a current company from this same customer pack.');
    need(target.id===incoming.id||api.keys(target.document).some(k=>api.keys(incoming.document).includes(k)),
      'Map aliases that share the same published company, request, buyer or email identity.');
    need(choice.action!=='keep'||choice.fields.length===0,'Keep current uses the current complete document.');
    const updated=choice.action==='update'?api.revision(candidate.leads,targetId,
      selectedFields(target.document,incoming.document,choice.fields,api,api.normalizeLead),at,{pack_id:packId}):target;
    applied.push({entity:'lead',source_id:incoming.id,target_id:targetId,before_revision:target.revision,after_revision:updated.revision,
      after_sha256:updated.sha256,updated_at:updated.updated_at,changed:target.revision!==updated.revision});
  }
  for(const key of ASSETS){
    const selection=choices.assets[key]??[];need(Array.isArray(selection)&&new Set(selection).size===selection.length,'Choose each original asset once.');
    for(const assetId of selection){
      const incoming=find(sourceAssetRows(source.source,key),id(assetId,'original asset ID'),'original '+key),rows=assetRows(candidate,key),current=rows.find(r=>r.id===incoming.id);
      need(!current||api.hash(current)===api.hash(incoming),'The selected original asset ID has different current content. Keep it in its source branch.',409,[{entity:key,id:incoming.id,reason:'The frozen original ID has different content.'}]);
      if(!current)setAssetRows(candidate,key,[...rows,clone(incoming)]);
      assets.push({entity:key,id:incoming.id,sha256:api.hash(incoming),added:!current});
    }
  }
  const received=api.validateCandidate(root,candidate,packId);
  return {root:received.root,report:received.report,applied,assets,canonical_before_sha256:before,
    canonical_after_sha256:received.report.can_receive?api.workingRecord(received.root,packId).sha256:null};
}
function preview(root,input,at,api){
  need(plain(input),'Choose a retained source.');const source=find(sources(root),id(input.source_id,'source ID'),'retained branch source');
  if(input.expected_source_sha256)need(input.expected_source_sha256===source.sha256,'Reopen the original retained source before reviewing it.',409);
  const current=find(root.packs,source.pack_id,'current customer brief'),completed=reviews(root).find(r=>r.source_id===source.id),
    choices=input.choices??completed?.choices??defaultChoices(root,source,api);
  const result={version:PREVIEW,pack_id:source.pack_id,source_id:source.id,source_sha256:source.sha256,
    received_at:source.received_at,source_note:source.note,incoming_sha256:source.source.sha256,baseline_sha256:source.baseline.sha256,
    current_sha256:api.workingRecord(root,source.pack_id).sha256,
    customer:current.document.customer.name,title:current.document.brief.title,
    review:clone(reviews(root).find(r=>r.source_id===source.id)||null),choices:clone(choices),
    brief:compare(current,source.source.pack,api),leads:[],assets:[],can_apply:false,conflicts:[],applied:[]};
  if(!plain(choices)||!Array.isArray(choices.leads)||!choices.leads.every(plain)||!plain(choices.assets)){
    result.conflicts=[{reason:'Review the complete brief, company mapping and original assets.'}];return result;
  }
  const own=root.leads.filter(r=>r.pack_id===source.pack_id);
  for(const incoming of source.source.leads){
    const choice=choices.leads?.find(r=>r.incoming_id===incoming.id),target=own.find(r=>r.id===choice?.target_id);
    const matches=own.filter(r=>r.id===incoming.id||api.keys(r.document).some(k=>api.keys(incoming.document).includes(k)));
    result.leads.push({incoming_id:incoming.id,organization:incoming.document.organization,company_domain:incoming.document.company_domain,
      target_id:target?.id||'',current_candidates:matches.map(r=>({id:r.id,organization:r.document.organization,revision:r.revision})),
      ...compare(target,incoming,api)});
  }
  for(const key of ASSETS)for(const row of sourceAssetRows(source.source,key)){
    const current=assetRows(root,key).find(r=>r.id===row.id);
    result.assets.push({entity:key,id:row.id,label:row.title||row.kind||row.id,
      state:current?(api.hash(current)===api.hash(row)?'current':'different'):'source',
      lead_ids:(row.leads||[]).map(r=>r.id),sha256:api.hash(row)});
  }
  if(result.review){result.conflicts=[{reason:'This retained source has its completed review. Its original decisions are available below.'}];return result;}
  try{
    const proposed=plan(root,source,choices,at,api);
    result.can_apply=proposed.report.can_receive;result.conflicts=proposed.report.conflicts;
    result.applied=proposed.applied;result.selected_assets=proposed.assets;
    result.canonical_after_sha256=proposed.canonical_after_sha256;
  }catch(error){
    if(!error.status)throw error;
    result.conflicts=error.details||[{reason:error.message}];
  }
  return result;
}
function apply(root,input,at,api){
  need(plain(input),'Supply the reviewed source choices.');const source=find(sources(root),id(input.source_id,'source ID'),'retained source');
  need(input.expected_source_sha256===source.sha256,'Reopen this exact source before applying its review.',409);
  need(!reviews(root).some(r=>r.source_id===source.id),'This source already has its completed review. Resume the original operation.',409);
  const reviewId=id(input.id,'review ID');need(!reviews(root).some(r=>r.id===reviewId),'This review ID already has retained work.',409);
  const reason=text(input.reason,'review reason',4000,true),proposed=plan(root,source,input.choices,at,api);
  need(proposed.report.can_receive,'The selected original assets do not fit the retained current histories. Review their references or keep them in the source branch.',409,proposed.report.conflicts);
  for(const key of Object.keys(proposed.root))Object.defineProperty(root,key,{value:proposed.root[key],enumerable:true,writable:true,configurable:true});
  const row=seal({version:REVIEW,id:reviewId,pack_id:source.pack_id,source_id:source.id,source_sha256:source.sha256,
    reviewed_at:at,reason,choices:clone(input.choices),canonical_before_sha256:proposed.canonical_before_sha256,
    canonical_after_sha256:proposed.canonical_after_sha256,applied:proposed.applied,assets:proposed.assets},api);
  (root.reconciliation_reviews??=[]).push(row);
  return {pack_id:source.pack_id,reconciliation_source_id:source.id,reconciliation_review_id:row.id,
    reconciled:true,changed_records:row.applied.filter(r=>r.changed).length,aliases:row.applied.filter(r=>r.entity==='lead'&&r.source_id!==r.target_id).length,
    selected_assets:row.assets.length};
}
function record(root,sourceId){
  const source=find(sources(root),sourceId,'retained branch source');
  return {version:'dealscout.lead-reconciliation-record.v1',source:clone(source),review:clone(reviews(root).find(r=>r.source_id===sourceId)||null)};
}
module.exports={VERSION,REVIEW,PREVIEW,validate,list,stage,preview,apply,record};
