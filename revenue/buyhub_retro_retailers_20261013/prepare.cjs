'use strict';
const core=require('./runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const sha=require('./runtime/host/connected_sha256.cjs');
const zip=require('./runtime/host/connected_zip.cjs');
const render=require('./customer-renderers.cjs');
function prepare(research,at){
 const packId=research.pack_id;let ledger={};const operations=[];
 const act=(kind,input)=>{const request={operation_id:packId+':prepare:'+operations.length,kind,input,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,request,at);ledger=result.ledger;operations.push({request,result:{...result,ledger:undefined}});return result;};
 act('pack-save',{id:packId,customer:{name:'BuyHub',company_domain:'buyhub.app',contact_url:'mailto:contact@buyhub.app',case_id:packId},brief:{title:'UK retro-game retailers — stock-sourcing prospect profiles',description:'Eight distinct UK retailer records: one free example, five additional paid profiles and two reserves. Every selected retailer publishes retro-game buying or trade activity and a business contact. Match any sourcing trial to its own platform, region, condition and delivered-cost requirements.',geography:'United Kingdom',skills:['retro games','console collection buying','stock sourcing','marketplace search'],lead_kind:'company_fit',quantity:5,currency:'USD',price_minor:2000,max_age_days:0,exclusions:'Hidden Chest/RetroGear and Geeky Blinders/Super Games World are each one company. Reserves remain outside the paid selection.'},operator_note:'Original case '+research.buyer.case_url+'. Sole BuyHub preparation/sender:379A work_scanner. Current reduced-volume owner direction applies. No retailer contact or actual buyer delivery event.'});
 act('leads-save',{pack_id:packId,leads:research.records.map(r=>({id:r.id,document:{...r,status_note:'Public buying/trade activity checked on 13 October 2026. '+r.qualification,operator_note:'Selection: '+r.selection+'. Complete source records: '+r.source_ids.join(', ')}}))});
 for(const kind of ['sample','paid'])act('edition-prepare',{pack_id:packId,id:packId+':'+kind+'-01',kind,lead_ids:research.records.filter(r=>r.selection===kind).map(r=>r.id)});
 const original=core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 const files={},exports={},scopes={};
 const instructions=render.instructions(research);files['customer/README.txt']=instructions;
 const fileInputs=[];
 function add(path,title,type,leadIds){const content=files[path],identity=sha.sha256Utf8(content),id=packId+':file:'+path.replace(/[^A-Za-z0-9._:-]/g,'-');fileInputs.push({id,document:{name:path.slice(9),title,type,description:title,lead_ids:leadIds,source_url:'',content_base64:zip.base64(zip.utf8(content)),bytes:identity.bytes,sha256:identity.sha256}});return id;}
 const shared=add('customer/README.txt','BuyHub profile instructions','text/plain',[]);
 for(const kind of ['sample','paid']){
  const editionId=packId+':'+kind+'-01',edition=original.editions.find(e=>e.id===editionId),exported=core.leadFulfillmentExport(ledger,{packId,editionId,format:'json'}).value;
  exports[kind]=exported;
  files['customer/'+kind+'/profiles.html']=render.html(exported,research);
  files['customer/'+kind+'/profiles.csv']=render.csv(exported,research);
  files['customer/'+kind+'/profiles.md']=render.markdown(exported,research);
  files['customer/'+kind+'/profiles.json']=JSON.stringify(exported,null,2)+'\n';
  scopes[kind]={editionId,files:[shared]};
  for(const [ext,type]of Object.entries({html:'text/html',csv:'text/csv',md:'text/markdown',json:'application/json'}))scopes[kind].files.push(add('customer/'+kind+'/profiles.'+ext,(kind==='sample'?'Free retailer example':'Five retailer profiles')+' — '+ext.toUpperCase(),type,edition.leads.map(l=>l.id)));
 }
 const saved=act('customer-files-save',{pack_id:packId,files:fileInputs});
 const packages={};
 for(const kind of ['sample','paid']){
  const id=packId+':'+kind+'-package-01',selected=saved.file_revisions.filter(f=>scopes[kind].files.includes(f.id));
  if(selected.length!==5)throw Error('Incomplete five-file package');
  act('customer-package-prepare',{pack_id:packId,id,edition_id:scopes[kind].editionId,title:kind==='sample'?'BuyHub — free UK retailer example':'BuyHub — five additional UK retailer profiles',instructions,files:selected});
  packages[kind]=core.leadCustomerPackageSelection(ledger,id,packId);
 }
 const working=core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 for(const key of Object.keys(original).filter(k=>k!=='sha256'))if(JSON.stringify(working[key])!==JSON.stringify(original[key]))throw Error('Original prepared field changed: '+key);
 const receive={operation_id:packId+':independent-receive',kind:'working-record-receive',expected_root_sha256:core.hash(core.validateRoot({})),input:{bundle:working}},received=core.applyLeadFulfillment({},receive,at);
 if(JSON.stringify(core.leadFulfillmentExport(received.ledger,{packId,format:'working-record'}).value)!==JSON.stringify(working))throw Error('Complete working record did not reopen');
 for(const kind of ['sample','paid'])if(JSON.stringify(core.leadCustomerPackageSelection(received.ledger,packId+':'+kind+'-package-01',packId))!==JSON.stringify(packages[kind]))throw Error('Package selection changed during receiving');
 files['working-record.json']=JSON.stringify(working,null,2)+'\n';files['preparation-receipt.json']=JSON.stringify({pack_id:packId,prepared_at:at,operations,receiving:{request:receive,received:received.received,equal:true},companies:working.leads.length,editions:working.editions.length,files:fileInputs.length,packages:Object.keys(packages).length},null,2)+'\n';
 const archives={};
 for(const kind of ['sample','paid']){
  const members=[{name:'README.txt',data:zip.utf8(instructions)}];
  for(const ext of ['html','csv','md','json'])members.push({name:'profiles.'+ext,data:zip.utf8(files['customer/'+kind+'/profiles.'+ext])});
  const bytes=zip.packStoredZip(members,{timestamp:at}),reopened=zip.readStoredZip(bytes);
  if(reopened.length!==members.length)throw Error('Member count changed');
  for(const originalMember of members){const actual=reopened.find(m=>m.name===originalMember.name);if(!actual||actual.bytes!==originalMember.data.length||sha.sha256Bytes(actual.data).sha256!==sha.sha256Bytes(originalMember.data).sha256)throw Error('Original ZIP member changed: '+originalMember.name);}
  archives[kind]={bytes:bytes.length,payload_base64:zip.base64(bytes),sha256:sha.sha256Bytes(bytes).sha256,members:members.map(m=>({name:m.name,bytes:m.data.length,sha256:sha.sha256Bytes(m.data).sha256})),reopened_equal:true};
 }
 return{ledger,working,files,packages,archives,operations,original,exports};
}
module.exports={prepare};
