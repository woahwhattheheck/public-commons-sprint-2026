'use strict';
/* Copyright 2026 TokenJunkieLabs. Complete recipient application and source delivery. */
const hash=require('../../host/connected_sha256.cjs');
const zip=require('../../host/connected_zip.cjs'),codec=require('../../host/connected_source_bytes.cjs').createSourceBytes();
const model=require('./model.cjs').createEventCollectionModel(hash),builder=require('./build_html.cjs');
function makeDelivery(working,{readSource,commercialFiles=[]}){
 const ws=model.validateWorkspace(working),source=name=>readSource('revenue/event_collection/'+name);
 const application=builder.buildEventCollectionHtml({workspace:ws,modelSource:source('model.cjs'),storageSource:source('storage.cjs'),deskSource:source('desk.cjs'),exportSource:source('event_collection_exports.mjs'),hashSource:readSource('host/connected_sha256.cjs'),codecSource:readSource('host/connected_source_bytes.cjs'),css:source('desk.css'),codec});
 const files=[{name:'START_HERE.md',data:'# Event collection desk · TJLabs\n\nOpen event-collection.html to use the complete saved collection. The browser runs its original source model and publishing adapters locally. Use Collection, Receive update, Entry editor, Publishing, Editions and Recovery.\n\nworking-collection.json contains the complete selected working archive. original-sources/ retains every original received snapshot. source/ contains the complete application modules and unchanged dependencies; guides are in source/revenue/event_collection/. public/ contains the separately supplied commissioning files when included.\n\nRead every publishing exception before using CSV or calendar output. The included public collection is partial; absence does not imply deletion. Use the complete working archive and original source files to reopen and reconcile.\n\nCopyright 2026 TokenJunkieLabs.\n'},{name:'event-collection.html',data:application},{name:'working-collection.json',data:model.exportArchive(ws)}];
 for(const snapshot of ws.snapshots)files.push({name:'original-sources/'+snapshot.id+'.json',data:model.canonical(snapshot)});
 const ownFiles=['model.cjs','storage.cjs','desk.cjs','desk.css','build_html.cjs','cli.cjs','pack_delivery.cjs','README.md','PLATFORM_INTEGRATION.md','event_collection_exports.mjs','receive_event_collection_model.mjs','receive_event_collection_browser.mjs'];
 for(const name of ownFiles)files.push({name:'source/revenue/event_collection/'+name,data:source(name)});
 for(const name of ['connected_sha256.cjs','connected_source_bytes.cjs','connected_zip.cjs','connected_gzip.cjs'])files.push({name:'source/host/'+name,data:readSource('host/'+name)});
 const allowed=new Set(['public/COMMISSIONING.md','public/commissioning-scope.json','public/america250-events.source.json','public/source-decisions.csv','public/customer-inputs.json','public/acceptance-cases.json']);
 for(const file of commercialFiles){if(!allowed.has(file.path)||typeof file.content!=='string')throw Error('Select only complete public commissioning files.');if(file.bytes!==undefined&&hash.sha256Utf8(file.content).bytes!==file.bytes)throw Error('Commissioning file length changed.');if(file.sha256&&hash.sha256Utf8(file.content).sha256!==file.sha256)throw Error('Commissioning file content changed.');files.push({name:file.path,data:file.content});}
 const names=files.map(f=>f.name);if(new Set(names).size!==names.length)throw Error('Repeated delivery member.');
 const manifest={schema:'tjlabs.event-collection-delivery/v1',workspace_id:ws.id,workspace_revision:ws.revision,workspace_seal:ws.seal,files:files.map(f=>({path:f.name,...hash.sha256Utf8(f.data)}))};
 files.push({name:'MANIFEST.json',data:JSON.stringify(manifest,null,2)+'\n'});
 return {manifest,files,zip:zip.packStoredZip(files),html:application};
}
function main(argv){
 const fs=require('node:fs'),path=require('node:path');
 const [archive,outDirectory,publicDirectory]=argv;if(!outDirectory)throw Error('pack_delivery.cjs WORKING_ARCHIVE OUTPUT_DIRECTORY [PUBLIC_COMMISSIONING_DIRECTORY]');
 const root=path.resolve(__dirname,'../..'),commercialFiles=[];
 if(publicDirectory)for(const name of ['COMMISSIONING.md','commissioning-scope.json','america250-events.source.json','source-decisions.csv','customer-inputs.json','acceptance-cases.json'])commercialFiles.push({path:'public/'+name,content:fs.readFileSync(path.join(publicDirectory,name),'utf8')});
 const result=makeDelivery(model.openArchive(fs.readFileSync(archive,'utf8')),{readSource:p=>fs.readFileSync(path.join(root,p),'utf8'),commercialFiles});
 fs.mkdirSync(outDirectory,{recursive:true});fs.writeFileSync(path.join(outDirectory,'event-collection-delivery.zip'),result.zip);fs.writeFileSync(path.join(outDirectory,'event-collection.html'),result.html);fs.writeFileSync(path.join(outDirectory,'delivery-manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');
 return {files:result.files.length,zip:hash.sha256Bytes(result.zip),html:hash.sha256Utf8(result.html),directory:path.resolve(outDirectory)};
}
if(require.main===module)try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n');}catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
module.exports={makeDelivery,main};
