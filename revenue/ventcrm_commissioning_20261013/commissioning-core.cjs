'use strict';
function createEngine(digest) {
 const SCHEMA='ventcrm.commissioning-workspace.v1';
 const fields=['owner','fleet','current_system','service_area','timezone','target_date','services_prices','booking_rules','payment_setup','texting_setup','migration_scope','customers_expected','customers_received','jobs_expected','jobs_received','invoices_expected','invoices_received','migration_exceptions','rollback_plan','training_plan','support_contact','export_location','retention_plan','agreement_reference','selected_setup_fee','selected_monthly_fee','billing_start','usage_cost_owner','active_removal_date','backup_expiry','notes'];
 const registers={files:['name','entity','rows','sha256','location','source_date','note'],mappings:['entity','source_field','target_field','transform','decision','note'],exports:['entity','route','file_ref','rows','keys','note'],open_work:['title','owner','due','status','output'],custody:['service','owner','reference','recovery']};
 const blankRegisters=()=>Object.fromEntries(Object.keys(registers).map(k=>[k,[]]));
 const clone=x=>JSON.parse(JSON.stringify(x));
 const need=(ok,msg)=>{if(!ok)throw Error(msg);};
 const text=(v,name,max=10000)=>{need(typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),name+' must be plain text within '+max+' characters.');return v;};
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 const hash=x=>digest(canonical(x));
 function validateSeed(seed){
  need(seed&&seed.version==='ventcrm.commissioning-seed.v1','The programme source version differs.');
  text(seed.title,'Title',160);need(Array.isArray(seed.operators)&&seed.operators.length<=100,'Up to 100 source operators are supported.');
  const ids=new Set();for(const o of seed.operators){need(o&&typeof o==='object','Operator source missing.');text(o.id,'Operator ID',180);need(o.id&&!ids.has(o.id),'Operator IDs must be distinct.');ids.add(o.id);for(const k of ['company','geography','contact','observed','proposal','qualification'])text(o[k],k,15000);need(Array.isArray(o.sources)&&o.sources.length<=20,'Original source list differs.');for(const u of o.sources)need(typeof u==='string'&&/^https:\/\//.test(u)&&u.length<2048,'Use an original HTTPS source.');}
  need(Array.isArray(seed.criteria)&&seed.criteria.length>0&&seed.criteria.length<=60,'The acceptance criteria are missing.');
  const checks=new Set();for(const c of seed.criteria){text(c.id,'Criterion ID',100);need(c.id&&!checks.has(c.id),'Criterion IDs must be distinct.');checks.add(c.id);for(const k of ['title','instruction','source_url'])text(c[k],k,4000);need(/^https:\/\//.test(c.source_url),'Criterion source must be HTTPS.');}
  return clone(seed);
 }
 function seal(state){state.checksum=hash(Object.fromEntries(Object.entries(state).filter(([k])=>k!=='checksum')));return state;}
 function create(seed,id){
  seed=validateSeed(seed);text(id,'Workspace ID',180);need(id.length>0,'Workspace ID required.');
  return seal({schema:SCHEMA,id,seed,seed_sha256:hash(seed),revision:0,operators:seed.operators.map(o=>({id:o.id,facts:Object.fromEntries(fields.map(k=>[k,''])),registers:blankRegisters(),checks:Object.fromEntries(seed.criteria.map(c=>[c.id,{status:'unreviewed',evidence:'',reviewer:'',checked_at:''}])),acceptance:null})),history:[]});
 }
 function validateFacts(facts){
  need(facts&&typeof facts==='object'&&!Array.isArray(facts),'Setup values must be an object.');
  need(Object.keys(facts).length===fields.length&&fields.every(k=>Object.hasOwn(facts,k)),'Complete setup fields are required.');
  for(const k of fields)text(facts[k],k);
  for(const k of ['fleet','customers_expected','customers_received','jobs_expected','jobs_received','invoices_expected','invoices_received'])if(facts[k]!=='')need(/^(0|[1-9]\d{0,7})$/.test(facts[k]),k+' must be a nonnegative whole number, or blank when unknown.');
  for(const k of ['selected_setup_fee','selected_monthly_fee'])if(facts[k]!=='')need(/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(facts[k]),k+' must be a nonnegative USD amount, or blank.');
  if(facts.target_date)need(/^\d{4}-\d{2}-\d{2}$/.test(facts.target_date)&&!Number.isNaN(Date.parse(facts.target_date+'T00:00:00Z'))&&new Date(facts.target_date+'T00:00:00Z').toISOString().slice(0,10)===facts.target_date,'Use a calendar date for the target.');
 }
 function readiness(state,operatorId){
  const o=state.operators.find(o=>o.id===operatorId);need(o,'Choose an operator in this programme.');
  const outstanding=state.seed.criteria.filter(c=>!['pass','not_applicable'].includes(o.checks[c.id].status)).map(c=>c.title);
  const missing=['owner','current_system','service_area','timezone','migration_scope','rollback_plan','training_plan','support_contact','export_location'].filter(k=>!o.facts[k].trim());
  const countDifferences=[];
  for(const prefix of ['customers','jobs','invoices']){const a=o.facts[prefix+'_expected'],b=o.facts[prefix+'_received'];if((a===''||b==='')&&(a!==''||b!==''))countDifferences.push(prefix+': enter both counts or leave both unknown');else if(a!==''&&a!==b)countDifferences.push(prefix+': '+a+' expected / '+b+' received');}
  const openWork=o.registers.open_work.filter(x=>x.status!=='done').map(x=>x.title+' — '+(x.owner||'owner needed'));return {outstanding,missing,countDifferences,openWork,ready:outstanding.length===0&&missing.length===0&&countDifferences.length===0&&openWork.length===0};
 }
 function execute(state,event){
  need(event&&event.expected_revision===state.revision,'The workspace changed. Reopen the current working copy before applying this change.');
  need(state.history.length<2000,'Export this completed programme before starting a new programme.');
  need(typeof event.at==='string'&&/^\d{4}-\d\d-\d\dT/.test(event.at)&&!Number.isNaN(Date.parse(event.at)),'Use an actual ISO operation time.');
  const o=state.operators.find(x=>x.id===event.operator_id);need(o,'Operator is outside this selected programme.');
  text(event.by,'Reviewer',160);need(event.by.trim(),'Enter the person recording this change.');
  if(event.kind==='facts-save'){validateFacts(event.facts);const changed=canonical(o.facts)!==canonical(event.facts);o.facts=clone(event.facts);if(changed){for(const c of state.seed.criteria)o.checks[c.id]={status:'unreviewed',evidence:'',reviewer:'',checked_at:''};o.acceptance=null;}}
  else if(event.kind==='register-save'){
   need(Object.hasOwn(registers,event.register),'Unknown programme register.');
   need(Array.isArray(event.rows)&&event.rows.length<=500,'Use up to 500 rows per register.');
   const ids=new Set();for(const row of event.rows){need(row&&typeof row==='object'&&Object.keys(row).length===registers[event.register].length+1,'Complete register row fields are required.');text(row.id,'Row ID',180);need(row.id&&!ids.has(row.id),'Register row IDs must be distinct.');ids.add(row.id);for(const k of registers[event.register])text(row[k],k,4000);if(Object.hasOwn(row,'rows')&&row.rows!=='')need(/^(0|[1-9]\d{0,8})$/.test(row.rows),'Record count must be a nonnegative whole number.');if(row.sha256)need(/^[0-9a-f]{64}$/.test(row.sha256),'Source SHA-256 must be 64 lower-case hexadecimal characters.');if(event.register==='mappings')need(['mapped','retained','excluded'].includes(row.decision),'Choose mapped, retained or excluded.');if(event.register==='exports')need(['self_serve','full_handover'].includes(row.route),'Choose self-serve or full handover.');if(event.register==='open_work')need(['open','done'].includes(row.status),'Choose open or done.');}
   if(canonical(o.registers[event.register])!==canonical(event.rows)){o.registers[event.register]=clone(event.rows);o.acceptance=null;for(const c of state.seed.criteria)o.checks[c.id]={status:'unreviewed',evidence:'',reviewer:'',checked_at:''};}
  }else if(event.kind==='check-save'){
   need(Object.hasOwn(o.checks,event.check_id),'Unknown acceptance criterion.');
   need(['unreviewed','pass','follow_up','fail','not_applicable'].includes(event.status),'Unknown check result.');
   text(event.evidence,'Check evidence',10000);if(event.status!=='unreviewed')need(event.evidence.trim(),'Record the observed result or reason for this check.');
   if(event.status==='pass'){
    const required={source:'files',mapping:'mappings',custody:'custody'};
    if(required[event.check_id])need(o.registers[required[event.check_id]].length>0,'Complete the '+required[event.check_id]+' register before marking this step passed.');
    if(['self_export','complete_export'].includes(event.check_id))need(o.registers.exports.some(x=>x.route===(event.check_id==='self_export'?'self_serve':'full_handover')),'Record the received export in its correct handover route first.');
   }
   o.checks[event.check_id]={status:event.status,evidence:event.evidence,reviewer:event.by,checked_at:event.at};o.acceptance=null;
  }else if(event.kind==='accept'){
   const r=readiness(state,o.id);need(r.ready,'Finish setup, count reconciliation and acceptance checks before accepting the programme.');
   text(event.summary,'Acceptance summary',10000);need(event.summary.trim(),'Record the acceptance decision.');
   o.acceptance={by:event.by,at:event.at,revision:state.revision+1,summary:event.summary};
  }else if(event.kind==='reopen'){text(event.reason,'Reopen reason',10000);need(event.reason.trim(),'Record why the accepted programme is reopened.');o.acceptance=null;}
  else throw Error('Unknown programme operation.');
  state.revision++;state.history.push(clone(event));return seal(state);
 }
 function receive(bundle){
  need(bundle&&bundle.schema===SCHEMA,'Choose a full commissioning workspace JSON file.');
  need(typeof bundle.checksum==='string','Workspace checksum missing.');
  need(bundle.checksum===hash(Object.fromEntries(Object.entries(bundle).filter(([k])=>k!=='checksum'))),'The saved workspace differs from its checksum.');
  need(Array.isArray(bundle.history)&&bundle.history.length<=2000,'Saved operation history differs.');
  let replay=create(bundle.seed,bundle.id);
  for(const event of bundle.history)replay=execute(replay,event);
  need(canonical(replay)===canonical(bundle),'The saved programme differs from its complete operation history.');
  return replay;
 }
 function apply(bundle,event){return execute(receive(bundle),clone(event));}
 function csv(state){
  state=receive(state);const cell=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  const rows=[['company','criterion','result','evidence','reviewer','checked_at','acceptance']];
  for(const source of state.seed.operators){const o=state.operators.find(x=>x.id===source.id);for(const c of state.seed.criteria){const r=o.checks[c.id];rows.push([source.company,c.title,r.status,r.evidence,r.reviewer,r.checked_at,o.acceptance?o.acceptance.by+' / '+o.acceptance.at:'']);}}
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 return {SCHEMA,fields,registers,hash,canonical,create,receive,apply,readiness,csv,validateSeed};
}
module.exports={createEngine};
