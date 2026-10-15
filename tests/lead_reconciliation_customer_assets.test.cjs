'use strict';
// Component regression tests for the existing reconciliation API. Provider identifiers
// are fixtures; these tests never call a mailbox or create an outbound message.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const path=require('node:path');
const reconcile=require(process.env.RECONCILIATION_MODULE||path.join(__dirname,'../tools/revenue_owner_console_20261010/lead_reconciliation_core.cjs'));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const at='2026-10-15T12:00:00.000Z',later='2026-10-15T13:00:00.000Z';
const mutable=(id,document,extra={})=>({id,...extra,revision:1,history:[],document:clone(document),sha256:hash(document),updated_at:at});
const versions=row=>[...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,updated_at:row.updated_at}];
function advance(row,document){return {...clone(row),history:versions(row),revision:row.revision+1,document:clone(document),sha256:hash(document),updated_at:later};}
const sealed=body=>({...body,sha256:hash(body)});
function contact(events=[]){return sealed({id:'contact-original',pack_id:'pack-original',case_id:'case-original',customer_package_id:'package-original',request:{operation_id:'prepare-original'},events:clone(events)});}
const newFields=['customer_files','customer_packages','customer_package_exports','customer_contacts'];
const allFields=['editions','deliveries','withdrawals',...newFields];
function root(){return {packs:[mutable('pack-original',{customer:{name:'Fixture Customer'},brief:{title:'Original brief'}})],leads:[],editions:[],deliveries:[],withdrawals:[]};}
function assets(){return {
  editions:[sealed({id:'edition-original',pack_id:'pack-original',leads:[]})],
  customer_files:[mutable('file-original',{name:'support/input.txt',content_base64:'b3JpZ2luYWw='},{pack_id:'pack-original'})],
  customer_packages:[sealed({id:'package-original',pack_id:'pack-original',edition_id:'edition-original',files:[{id:'file-original',revision:1}]})],
  customer_package_exports:[sealed({id:'package-original',pack_id:'pack-original',package_id:'package-original',archive:{content_base64:'Zml4dHVyZS1hcmNoaXZl'}})],
  customer_contacts:[contact([{id:'event-original',kind:'RECEIVED',value:{message_id:'fixture-message-original',delivery:{id:'delivery-original'}}}])],
  deliveries:[{id:'delivery-original',edition_id:'edition-original',provider_id:'fixture-message-original'}]
};}
function workingRecord(value,packId){
  const body={version:'fixture.working-record',pack:clone(value.packs.find(p=>p.id===packId)),leads:clone(value.leads)};
  for(const key of allFields)if(value[key]!==undefined)body[key]=clone(value[key]);
  return sealed(body);
}
// The real fulfillment receiver supplies the same revision and candidate-validation
// hooks. This adapter checks dependency atomicity; it does not replace native receipt
// or archive-byte validation owned by that receiver.
const api={hash,workingRecord,normalizePack:clone,normalizeLead:clone,keys:d=>[d.organization].filter(Boolean),
  revision(rows,id,document,time,extra={}){
    const current=rows.find(row=>row.id===id);
    if(current&&current.sha256===hash(document))return current;
    const result=current?advance(current,document):mutable(id,document,extra);
    result.updated_at=time;if(current)rows[rows.indexOf(current)]=result;else rows.push(result);return result;
  },
  validateBundle(bundle){const {sha256,...body}=bundle;assert.equal(sha256,hash(body));},
  validateCandidate(original,candidate){
    const conflicts=[];
    for(const row of candidate.customer_packages||[]){
      if(!candidate.editions.some(e=>e.id===row.edition_id)||!row.files.every(ref=>(candidate.customer_files||[]).some(file=>file.id===ref.id&&versions(file).some(v=>v.revision===ref.revision))))conflicts.push({reason:'Missing original edition or file revision.'});
    }
    for(const row of candidate.customer_package_exports||[])if(!(candidate.customer_packages||[]).some(p=>p.id===row.package_id))conflicts.push({reason:'Missing original package.'});
    for(const row of candidate.customer_contacts||[])if(!(candidate.customer_packages||[]).some(p=>p.id===row.customer_package_id)||!row.events.filter(e=>e.kind==='RECEIVED').every(e=>candidate.deliveries.some(d=>d.id===e.value.delivery.id)))conflicts.push({reason:'Missing original package or delivery.'});
    return {root:candidate,report:{can_receive:!conflicts.length,conflicts}};
  }
};
function stage(target,source,sourceId='source-original'){
  reconcile.stage(target,{id:sourceId,bundle:workingRecord(source,'pack-original')},at,api);
  const preview=reconcile.preview(target,{source_id:sourceId},at,api);
  return {source_id:sourceId,expected_source_sha256:preview.source_sha256,id:'review-'+sourceId,reason:'Receive selected original customer assets.',choices:preview.choices};
}
function choose(input,source){for(const key of allFields)input.choices.assets[key]=(source[key]||[]).map(row=>row.id);return input;}
function apply(target,input){const result=reconcile.apply(target,input,later,api);reconcile.validate(target,api);return result;}

test('whole customer source is selectable and survives apply, serialization and review reopening',()=>{
  const target=root(),source={...root(),...assets()},input=choose(stage(target,source),source);
  const preview=reconcile.preview(target,input,later,api);
  assert.equal(preview.can_apply,true);
  for(const key of newFields)assert(preview.assets.some(a=>a.entity===key));
  apply(target,input);
  const reopened=JSON.parse(JSON.stringify(target));reconcile.validate(reopened,api);
  for(const key of allFields)assert.deepEqual(reopened[key],source[key]);
  assert.equal(reconcile.record(reopened,input.source_id).review.assets.length,6);
  assert.equal(reconcile.preview(reopened,{source_id:input.source_id},later,api).review.id,input.id);
});
test('file and contact prefixes advance together; later continuations preserve completed reviews',()=>{
  const target={...root(),...assets()},source=clone(target);
  source.customer_files[0]=advance(source.customer_files[0],{...source.customer_files[0].document,content_base64:'bmV3'});
  source.customer_contacts[0]=contact([...source.customer_contacts[0].events,{id:'event-later',kind:'RECEIVED',value:{message_id:'fixture-message-original',delivery:{id:'delivery-original'}}}]);
  apply(target,choose(stage(target,source),source));
  assert.equal(target.customer_files[0].revision,2);assert.equal(target.customer_contacts[0].events.length,2);
  assert.equal(target.reconciliation_reviews[0].assets.filter(a=>a.advanced).length,2);
  target.customer_files[0]=advance(target.customer_files[0],{...target.customer_files[0].document,content_base64:'bGF0ZXI='});
  target.customer_contacts[0]=contact([...target.customer_contacts[0].events,{id:'event-last',kind:'RECEIVED',value:{message_id:'fixture-message-original',delivery:{id:'delivery-original'}}}]);
  reconcile.validate(target,api);
});
test('older copies never downgrade a file or contact and replay never duplicates a delivery',()=>{
  const source={...root(),...assets()},target=clone(source);
  target.customer_files[0]=advance(target.customer_files[0],{...target.customer_files[0].document,content_base64:'bmV3'});
  target.customer_contacts[0]=contact([...target.customer_contacts[0].events,{id:'event-later',kind:'RECEIVED',value:{message_id:'fixture-message-original',delivery:{id:'delivery-original'}}}]);
  const before=clone(target),input=choose(stage(target,source),source);apply(target,input);
  assert.deepEqual(target.customer_files,before.customer_files);assert.deepEqual(target.customer_contacts,before.customer_contacts);
  assert.equal(target.deliveries.length,1);const after=clone(target);
  assert.throws(()=>apply(target,input),/completed review/);assert.deepEqual(target,after);
});
test('divergent histories and immutable identity collisions leave the workspace untouched',()=>{
  for(const key of newFields){
    const target={...root(),...assets()},source=clone(target);
    if(key==='customer_files')source[key][0].document.content_base64='Zm9yaw==';
    else if(key==='customer_contacts')source[key][0].events[0].value.message_id='fixture-other-message';
    else source[key][0].different='fork';
    const input=choose(stage(target,source),source),before=clone(target);
    assert.equal(reconcile.preview(target,input,later,api).can_apply,false,key);
    assert.throws(()=>reconcile.apply(target,input,later,api),/divergent current content/);
    assert.deepEqual(target,before,key);
  }
});
test('incomplete dependency selections fail before any asset is published',()=>{
  const target=root(),source={...root(),...assets()},input=stage(target,source);
  input.choices.assets.customer_contacts=['contact-original'];const before=clone(target);
  assert.equal(reconcile.preview(target,input,later,api).can_apply,false);
  assert.throws(()=>reconcile.apply(target,input,later,api),/do not fit/);assert.deepEqual(target,before);
});
test('legacy choices still work and source mutation cannot rewrite a completed review',()=>{
  const target=root(),source=root(),input=stage(target,source);
  for(const key of newFields)delete input.choices.assets[key];apply(target,input);
  const bundle=target.reconciliation_sources[0].source;bundle.pack.document.brief.title='Changed';
  assert.throws(()=>reconcile.validate(target,api),/changed/);
});
