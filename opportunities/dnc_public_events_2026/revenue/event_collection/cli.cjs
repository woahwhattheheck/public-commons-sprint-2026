#!/usr/bin/env node
'use strict';
/* Copyright 2026 TokenJunkieLabs. File-based collection operation. */
const fs=require('node:fs'),path=require('node:path');
const hashes=require('../../host/connected_sha256.cjs');
const {createEventCollectionModel}=require('./model.cjs'),model=createEventCollectionModel(hashes);
const read=p=>fs.readFileSync(p,'utf8'),json=p=>JSON.parse(read(p));
function atomic(p,text){const absolute=path.resolve(p),directory=path.dirname(absolute);fs.mkdirSync(directory,{recursive:true});const temp=absolute+'.'+process.pid+'.tmp';const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,absolute);const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
async function main(argv){
 const [command,...args]=argv;
 if(command==='create'){const [sourceFile,out,id,title]=args;if(!title)throw Error('create SOURCE OUTPUT COLLECTION_ID TITLE');const source=model.snapshot(json(sourceFile));let w=model.createWorkspace({id,title},operation());w=model.applyImport(w,model.previewImport(w,source),{},operation());atomic(out,model.exportArchive(w));return summary(w);}
 if(command==='inspect'){const w=model.openArchive(read(args[0]));return summary(w);}
 if(command==='compare'){const [archive,source,out]=args;atomic(out,model.canonical(model.previewImport(model.openArchive(read(archive)),json(source))));return{review:out};}
 if(command==='apply'){const [archive,planFile,choicesFile,out]=args;const w=model.applyImport(model.openArchive(read(archive)),json(planFile),json(choicesFile),operation());atomic(out,model.exportArchive(w));return summary(w);}
 if(command==='edit'){const [archive,entryId,patchFile,out]=args;const w=model.editEntry(model.openArchive(read(archive)),entryId,json(patchFile),operation());atomic(out,model.exportArchive(w));return summary(w);}
 if(command==='edition'){const [archive,title,out]=args;const w=model.saveEdition(model.openArchive(read(archive)),title,operation());atomic(out,model.exportArchive(w));return summary(w);}
 if(command==='restore'){const [archive,id,out]=args;const w=model.restoreEdition(model.openArchive(read(archive)),id,operation());atomic(out,model.exportArchive(w));return summary(w);}
 if(command==='export'){const [archive,format,outDirectory,targetFile]=args;const w=model.openArchive(read(archive)),{createEventExportAdapter}=await import('./event_collection_exports.mjs');const result=createEventExportAdapter(model).buildExport(w,{format,entryIds:w.entries.filter(x=>x.disposition==='active').map(x=>x.id),generatedAt:new Date().toISOString(),target:targetFile?json(targetFile):w.target});fs.mkdirSync(outDirectory,{recursive:true});for(const f of result.files){if(path.basename(f.name)!==f.name)throw Error('Export filename must be a plain attachment name.');atomic(path.join(outDirectory,f.name),f.content);}atomic(path.join(outDirectory,'export-result.json'),JSON.stringify(result,null,2)+'\n');return{directory:outDirectory,selected:result.selected_ids,exported:result.exported_ids,omitted:result.omitted_ids,issues:result.issues};}
 if(command==='html'){const [archive,out]=args;const {buildEventCollectionHtml}=require('./build_html.cjs'),codec=require('../../host/connected_source_bytes.cjs').createSourceBytes();const w=model.openArchive(read(archive));const source=name=>read(path.join(__dirname,name));atomic(out,buildEventCollectionHtml({workspace:w,modelSource:source('model.cjs'),storageSource:source('storage.cjs'),deskSource:source('desk.cjs'),exportSource:source('event_collection_exports.mjs'),hashSource:read(path.join(__dirname,'../../host/connected_sha256.cjs')),codecSource:read(path.join(__dirname,'../../host/connected_source_bytes.cjs')),css:source('desk.css'),codec}));return{html:out,...summary(w)};}
 throw Error('Commands: create, inspect, compare, apply, edit, edition, restore, export, html. Supply exact file paths; outputs preserve the original input.');
}
function operation(){return{id:require('node:crypto').randomUUID(),actor:process.env.EVENT_COLLECTION_ACTOR||'Local collection editor',at:new Date().toISOString()};}
function summary(w){return{id:w.id,revision:w.revision,entries:w.entries.length,snapshots:w.snapshots.length,editions:w.editions.length,seal:w.seal};}
if(require.main===module)main(process.argv.slice(2)).then(v=>process.stdout.write(JSON.stringify(v,null,2)+'\n')).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
module.exports={main};
