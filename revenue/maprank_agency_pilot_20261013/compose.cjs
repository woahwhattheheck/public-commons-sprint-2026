'use strict';
const Core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const Sha=require('./host/connected_sha256.cjs');
const Zip=require('./host/connected_zip.cjs');
const Pilot=require('./pilot-core.cjs');
const {render}=require('./render.cjs');
const ORIGINAL='86affa1e8b35f1418fb09c58a474c098d4864dfb7ce8714d05d192bb4899d434';
const AT='2026-10-13T14:30:00.000Z';
function compose(original,files){
 if(original.sha256!==ORIGINAL||original.leads.length!==6||original.editions.length!==2)throw Error('Receive the complete current original six-agency record.');
 const packId=original.pack.id,operations=[];let ledger={};
 function apply(suffix,kind,input){const body={operation_id:packId+':pilot-desk:'+suffix,kind,input,expected_root_sha256:Core.hash(Core.validateRoot(ledger))};ledger=Core.applyLeadFulfillment(ledger,body,AT).ledger;operations.push({body,at:AT});}
 apply('original','working-record-receive',{bundle:original});
 if(Core.hash(Core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value)!==Core.hash(original))throw Error('Original full record did not reopen.');
 const customerFiles=[],specs=[],desks=[],packages=[];
 function add(name,content,type,leadIds,title){
 const identity=Sha.sha256Utf8(content),id=packId+':pilot-file:'+name.replaceAll('/',':');
 customerFiles.push({path:'customer/'+name,content,...identity});specs.push({id,name,title,description:title,type,lead_ids:leadIds,source_url:'',content_base64:Zip.base64(Zip.utf8(content)),...identity});return id;
 }
 const start=files['START-HERE.md'],guideId=add('pilot/START-HERE.md',start,'text/markdown',[],'Complete pilot operation and receiving guide');
 for(const kind of ['sample','paid']){
  const edition=original.editions.find(e=>e.kind===kind),originalPackage=original.customer_packages.find(p=>p.edition_id===edition.id);
  if(!originalPackage||edition.leads.length!==(kind==='sample'?1:5))throw Error('The original edition selection differs.');
  const seed={edition_id:edition.id,agencies:edition.leads,guide:files['MAPRANK-PILOT-OPERATOR.md']+'\n'+files['MAPRANK-METRIC-RULES.md'],sources:JSON.parse(files['MAPRANK-SOURCES.json']).sources};
  const working=Pilot.create(seed),html=render({seed,files});
  if(Pilot.canonical(Pilot.receive(working,seed))!==Pilot.canonical(working))throw Error('Complete blank desk did not reopen.');
  const ids=edition.leads.map(x=>x.id),appId=add('pilot/'+kind+'-desk.html',html,'text/html',ids,'Complete editable '+kind+' agency pilot desk'),workingId=add('pilot/'+kind+'-working.json',JSON.stringify(working,null,2)+'\n','application/json',ids,'Complete blank '+kind+' pilot working file');
  const sourceNames=['pilot-core.cjs','host/connected_sha256.cjs','app.js','styles.css','render.cjs','MAPRANK-PILOT-OPERATOR.md','MAPRANK-METRIC-RULES.md','maprank-pilot-fields.json','MAPRANK-SOURCES.json'];
  const source={schema:'maprank.pilot-source.v1',seed,files:Object.fromEntries(sourceNames.map(p=>[p,files[p]]))};
  const sourceId=add('pilot/'+kind+'-source.json',JSON.stringify(source,null,2)+'\n','application/json',ids,'Complete selected application source');
  desks.push({kind,edition_id:edition.id,original_package_id:originalPackage.id,file_ids:[...originalPackage.files.map(f=>f.id),appId,workingId,sourceId,guideId],working,html});
 }
 apply('files','customer-files-save',{pack_id:packId,files:specs});
 for(const desk of desks){
  const saved=Core.validateRoot(ledger),id=packId+':'+desk.kind+':complete-pilot-20261013';
  apply(desk.kind,'customer-package-prepare',{pack_id:packId,id,edition_id:desk.edition_id,title:'MapRank '+(desk.kind==='sample'?'one-agency':'five-agency')+' pilot programme',instructions:'Read pilot/START-HERE.md, open the original profile HTML and pilot/'+desk.kind+'-desk.html. Use Open working file to receive pilot/'+desk.kind+'-working.json. Save the complete working record with source attachments after use. Complete source is included in pilot/'+desk.kind+'-source.json.',files:desk.file_ids.map(id=>{const f=saved.customer_files.find(x=>x.id===id);if(!f)throw Error('Selected file missing');return{id:f.id,revision:f.revision,sha256:f.sha256};})});
  packages.push({id,selection:Core.leadCustomerPackageSelection(ledger,id,packId)});
 }
 const working=Core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 for(const key of Object.keys(original).filter(k=>!['sha256','customer_files','customer_packages'].includes(k)))if(Core.hash(original[key])!==Core.hash(working[key]))throw Error('Original field changed: '+key);
 for(const key of ['customer_files','customer_packages'])for(const entry of original[key])if(Core.hash(entry)!==Core.hash(working[key].find(x=>x.id===entry.id)))throw Error('Original customer selection changed: '+entry.id);
 const reopened=Core.applyLeadFulfillment({},{operation_id:packId+':pilot-desk:reopen',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:Core.hash(Core.validateRoot({}))},AT).ledger;
 if(Core.hash(Core.leadFulfillmentExport(reopened,{packId,format:'working-record'}).value)!==Core.hash(working))throw Error('Complete successor did not independently reopen.');
 const archives=[];
 for(const p of packages){
  if(Core.hash(Core.leadCustomerPackageSelection(reopened,p.id,packId))!==Core.hash(p.selection))throw Error('The selected package did not reopen.');
  const entries=p.selection.files.map(f=>{const d=f.document,bytes=Zip.fromBase64(d.content_base64);if(Sha.sha256Bytes(bytes).sha256!==d.sha256||bytes.length!==d.bytes)throw Error('Original member bytes differ.');return{name:d.name,data:bytes,mode:0o644};}),data=Zip.packStoredZip(entries,{timestamp:AT}),members=Zip.readStoredZip(data);
  if(members.length!==entries.length)throw Error('Complete archive member count differs.');
  for(const member of members){const f=p.selection.files.find(f=>f.document.name===member.name).document;if(member.bytes!==f.bytes||Sha.sha256Bytes(member.data).sha256!==f.sha256)throw Error('Reopened member differs.');}
  const kind=desks.find(d=>d.edition_id===p.selection.edition.id).kind;
  archives.push({name:'MapRank-'+kind+'-complete-pilot.zip',package_id:p.id,edition_id:p.selection.edition.id,title:p.selection.packet.title,quantity:p.selection.edition.leads.length,bytes:data.length,sha256:Sha.sha256Bytes(data).sha256,data,files:p.selection.files.map(f=>({name:f.document.name,bytes:f.document.bytes,sha256:f.document.sha256}))});
 }
 return {working_record:working,operations,customer_files:customerFiles,desks,archives,validation:{original_fields_equal:true,original_customer_files_equal:true,original_packages_equal:true,complete_reopen_equal:true,package_reopen_equal:true,archive_members_equal:true,original_agencies:6,original_editions:2,customer_files:working.customer_files.length,customer_packages:working.customer_packages.length}};
}
module.exports={compose,ORIGINAL,AT};
