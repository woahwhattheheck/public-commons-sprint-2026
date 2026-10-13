#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const core=require('./runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const sha=require('./runtime/host/connected_sha256.cjs');
const {createLocalizationCore}=require('./localization/localization-core.cjs');
const {localizationHtml}=require('./localization/localization-view.cjs');
const {composeLocalizationDelivery}=require('./localization/compose.cjs');
const {operateExample}=require('./localization/operate-example.cjs');
const {zip}=require('./localization/zip.cjs');
const api=createLocalizationCore(sha),root=__dirname,out=path.resolve(process.argv[2]||path.join(root,'localization-output'));
if(fs.existsSync(out))throw Error('Choose a new complete output directory');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const original=JSON.parse(read('source/pre-recovery-working-record.json'));
const records=JSON.parse(read('source-records.json')).records,at='2026-10-13T15:00:00.000Z';
const guide=read('localization/README.txt'),customerFiles={'customer/localization-README.txt':guide},examples={};
const sourceContent={
 'localization-core.cjs':read('localization/localization-core.cjs'),
 'localization-view.cjs':read('localization/localization-view.cjs'),
 'connected_sha256.cjs':read('runtime/host/connected_sha256.cjs'),
 'rebuild.cjs':read('localization/rebuild.cjs'),
 'README.txt':guide
};
for(const kind of['sample','paid']){
 const edition=original.editions.find(x=>x.kind===kind),working=read('customer/localization-'+kind+'/working.json'),workspace=api.receive(JSON.parse(working));
 if(workspace.selection.editionId!==edition.id)throw Error('Retain the exact original customer working selection');
 const sourceFiles=Object.entries({...sourceContent,'initial-working.json':working}).map(([name,content])=>({path:name,content,...sha.sha256Utf8(content)}));
 const prefix='customer/localization-'+kind+'/';
 customerFiles[prefix+'app.html']=localizationHtml({coreSource:sourceContent['localization-core.cjs'],shaSource:sourceContent['connected_sha256.cjs'],workspace,sourceFiles,guide});
 customerFiles[prefix+'application-source.json']=JSON.stringify({schema:'tjlabs.localization-application-source.v1',files:sourceFiles},null,2)+'\n';
 customerFiles[prefix+'working.json']=working;
 examples[kind]=operateExample(api,workspace);
}
const result=composeLocalizationDelivery(core,sha,original,customerFiles,at);
fs.mkdirSync(out,{mode:0o700});
const write=(name,content)=>{const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,content,{flag:'wx',mode:0o600});};
for(const[name,content]of Object.entries(customerFiles))write(name,content);
write('working-record.json',JSON.stringify(result.working,null,2)+'\n');
write('localization-package-receipt.json',JSON.stringify({schema:'unlost.localization-delivery.v1',prepared_at:at,pack_id:original.pack.id,working_record_sha256:result.working.sha256,companies:result.working.leads.length,editions:result.working.editions.length,customer_files:result.working.customer_files.length,customer_packages:result.working.customer_packages.length,package_ids:result.packageIds,original_values_preserved:result.originalValuesPreserved,received_equal:result.receivedEqual,files:result.fileIdentities},null,2)+'\n');
for(const[k,value]of Object.entries(examples)){write('worked-examples/'+k+'.json',JSON.stringify(value,null,2)+'\n');write('worked-examples/'+k+'-content.csv',value.csv);}
for(const[k,selection]of Object.entries(result.packages)){
 const members=[];
 for(const f of selection.files){const bytes=Buffer.from(f.document.content_base64,'base64');if(bytes.length!==f.document.bytes||sha.sha256Utf8(bytes.toString('utf8')).sha256!==f.document.sha256)throw Error('Complete customer file differs');write('packages/'+k+'/'+f.document.name,bytes);members.push({name:f.document.name,bytes});}
 write('Unlost-localization-'+k+'.zip',zip(members));
 write('packages/'+k+'/package-manifest.json',JSON.stringify({package:selection.packet,files:selection.files.map(f=>({id:f.id,name:f.document.name,bytes:f.document.bytes,sha256:f.document.sha256}))},null,2)+'\n');
}
process.stdout.write(JSON.stringify({output:out,companies:result.working.leads.length,editions:result.working.editions.length,customerFiles:result.working.customer_files.length,customerPackages:result.working.customer_packages.length,workingSha256:result.working.sha256,receivedEqual:result.receivedEqual,originalValuesPreserved:result.originalValuesPreserved,workedOperations:Object.fromEntries(Object.entries(examples).map(([k,v])=>[k,v.requests.length]))},null,2)+'\n');
