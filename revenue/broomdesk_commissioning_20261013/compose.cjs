'use strict';
const Core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs'),Sha=require('./host/connected_sha256.cjs'),Zip=require('./host/connected_zip.cjs'),Desk=require('./commissioning-core.cjs'),{render}=require('./render.cjs');
const ORIGINAL='287474016014b103bd2c951ccf947ca45eb2788617c873cdac9617b26b37cb2f',AT='2026-10-13T16:00:00.000Z';
function compose(original,files){
 if(original.sha256!==ORIGINAL||original.leads.length!==6||original.editions.length!==2)throw Error('Receive the complete original six-company record.');
 const archives=JSON.parse(files['original-archives.json']).archives,packId=original.pack.id,operations=[];let ledger={};
 const apply=(suffix,kind,input)=>{const body={operation_id:packId+':commissioning:'+suffix,kind,input,expected_root_sha256:Core.hash(Core.validateRoot(ledger))};ledger=Core.applyLeadFulfillment(ledger,body,AT).ledger;operations.push({body,at:AT});};
 apply('receive','working-record-receive',{bundle:original});if(Core.hash(Core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value)!==Core.hash(original))throw Error('Original full record did not reopen.');
 const specs=[],customerFiles=[],desks=[],selected=[];
 const add=(id,name,content,type,leadIds,title)=>{const hash=Sha.sha256Utf8(content);specs.push({id,name,title,description:title,type,lead_ids:leadIds,source_url:'',content_base64:Zip.base64(Zip.utf8(content)),...hash});customerFiles.push({path:'customer/'+name,content,...hash});return id;};
 const guide=add(packId+':guide','START-HERE.md',files['START-HERE.md'],'text/markdown',[],'Complete commissioning and receiving guide');
 for(const kind of ['sample','paid']){
  const index=kind==='sample'?0:1,archive=archives[index],edition=original.editions.find(e=>e.kind===kind),leadIds=edition.leads.map(x=>x.id),prefix='profiles/'+kind+'/';
  const raw=Zip.fromBase64(archive.content_base64);if(raw.length!==archive.bytes||Sha.sha256Bytes(raw).sha256!==archive.sha256)throw Error('Original reviewed archive bytes differ.');
  const manifest=JSON.parse(archive.members.find(x=>x.name==='manifest.json').content),actual=JSON.parse(archive.members.find(x=>x.name==='leads.json').content),expected=Core.customerEdition(edition);
  // The original exporter used the complete brief title for its free sample.
  if(kind==='sample'&&actual.title===edition.brief.brief.title)expected.title=actual.title;
  if(Core.hash(actual)!==Core.hash(expected))throw Error('Original customer edition differs from its immutable company selection.');
  for(const m of archive.members){const identity=Sha.sha256Utf8(m.content);if(identity.bytes!==m.bytes||identity.sha256!==m.sha256)throw Error('Original reviewed member differs: '+m.name);if(m.name!=='manifest.json'){const a=manifest.files.find(x=>x.name===m.name);if(!a||a.bytes!==m.bytes||a.sha256!==m.sha256)throw Error('Original customer manifest differs.');}}
  const originalIds=archive.members.map(m=>add(packId+':'+kind+':original:'+m.name.replaceAll('.','-'),prefix+m.name,m.content,m.name.endsWith('.html')?'text/html':m.name.endsWith('.json')?'application/json':m.name.endsWith('.csv')?'text/csv':'text/plain',leadIds,'Original reviewed '+kind+' '+m.name));
  const seed={edition_id:edition.id,companies:edition.leads,criteria:JSON.parse(files['BROOMDESK-CRITERIA.json']).criteria,guide:files['BROOMDESK-OPERATOR.md'],sources:JSON.parse(files['BROOMDESK-SOURCES.json'].replace(/\u00a0/g,' ')).sources},working=Desk.create(seed),html=render({seed,files});
  if(Desk.canonical(Desk.receive(working,seed))!==Desk.canonical(working))throw Error('Blank working file did not reopen.');
  const names=['commissioning-core.cjs','host/connected_sha256.cjs','app.js','styles.css','render.cjs','BROOMDESK-OPERATOR.md','BROOMDESK-CRITERIA.json','BROOMDESK-SOURCES.json'],source={schema:'broomdesk.commissioning-source.v1',seed,files:Object.fromEntries(names.map(p=>[p,files[p]]))};
  const deskIds=[
   add(packId+':'+kind+':app','desk/'+kind+'/commissioning.html',html,'text/html',leadIds,'Complete editable '+kind+' commissioning desk'),
   add(packId+':'+kind+':working','desk/'+kind+'/blank-working.json',JSON.stringify(working,null,2)+'\n','application/json',leadIds,'Complete blank '+kind+' working file'),
   add(packId+':'+kind+':source','desk/'+kind+'/application-source.json',JSON.stringify(source,null,2)+'\n','application/json',leadIds,'Complete selected application source')
  ];
  desks.push({kind,edition_id:edition.id,original_ids:originalIds,all_ids:[...originalIds,...deskIds,guide],working,html,original_archive:{name:archive.name,bytes:archive.bytes,sha256:archive.sha256}});
 }
 apply('files','customer-files-save',{pack_id:packId,files:specs});
 for(const d of desks)for(const complete of [false,true]){
  const id=packId+':'+d.kind+(complete?':complete-commissioning':':original-reviewed-files'),root=Core.validateRoot(ledger),ids=complete?d.all_ids:d.original_ids;
  apply(d.kind+(complete?'-complete':'-original'),'customer-package-prepare',{pack_id:packId,id,edition_id:d.edition_id,title:'BroomDesk '+d.kind+(complete?' complete commissioning programme':' reviewed original selection'),instructions:complete?'Read START-HERE.md; open profiles/'+d.kind+'/lead-pack.html and desk/'+d.kind+'/commissioning.html. Complete the actual operating course, save the working file and independently reopen.':'Read the original START_HERE.txt and every complete original profile member.',files:ids.map(id=>{const row=root.customer_files.find(x=>x.id===id);return{id,revision:row.revision,sha256:row.sha256};})});
  if(complete)selected.push({kind:d.kind,id,selection:Core.leadCustomerPackageSelection(ledger,id,packId)});
 }
 const working=Core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 for(const key of Object.keys(original).filter(k=>k!=='sha256'))if(Core.hash(original[key])!==Core.hash(working[key]))throw Error('Original record field changed: '+key);
 const reopened=Core.applyLeadFulfillment({},{operation_id:packId+':commissioning:reopen',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:Core.hash(Core.validateRoot({}))},AT).ledger;
 if(Core.hash(Core.leadFulfillmentExport(reopened,{packId,format:'working-record'}).value)!==Core.hash(working))throw Error('Full successor receiving differs.');
 const completeArchives=selected.map(p=>{
  if(Core.hash(Core.leadCustomerPackageSelection(reopened,p.id,packId))!==Core.hash(p.selection))throw Error('Selected package receiving differs.');
  const entries=p.selection.files.map(f=>({name:f.document.name,data:Zip.fromBase64(f.document.content_base64),mode:0o644})),data=Zip.packStoredZip(entries,{timestamp:AT}),members=Zip.readStoredZip(data);
  if(members.length!==entries.length)throw Error('Whole archive member count differs.');for(const m of members){const f=p.selection.files.find(x=>x.document.name===m.name).document;if(m.bytes!==f.bytes||Sha.sha256Bytes(m.data).sha256!==f.sha256)throw Error('Whole archive member differs.');}
  return{name:'BroomDesk-'+p.kind+'-complete-commissioning.zip',kind:p.kind,package_id:p.id,edition_id:p.selection.edition.id,title:p.selection.packet.title,quantity:p.selection.edition.leads.length,bytes:data.length,sha256:Sha.sha256Bytes(data).sha256,data,files:p.selection.files.map(f=>({name:f.document.name,bytes:f.document.bytes,sha256:f.document.sha256}))};
 });
 return{working_record:working,operations,customer_files:customerFiles,desks,archives:completeArchives,validation:{original_full_fields_equal:true,original_companies:6,original_editions:2,original_delivery_events:original.deliveries.length,original_reviewed_archives_equal:true,original_member_bytes_equal:true,full_record_reopen_equal:true,all_package_selections_equal:true,complete_archive_members_equal:true,customer_files:working.customer_files.length,customer_packages:working.customer_packages.length}};
}
module.exports={compose,ORIGINAL,AT};
