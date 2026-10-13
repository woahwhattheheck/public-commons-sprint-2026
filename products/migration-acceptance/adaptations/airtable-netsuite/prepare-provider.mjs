#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile,open,mkdir,link,unlink,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {prepareProviderMigration,bindProviderPipeline,compareCapturePopulations,digest,json,requireValue} from './provider-input.mjs';
async function save(root,path,content){
 requireValue(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&path.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe prepared member.');
 const final=join(root,path);await mkdir(dirname(final),{recursive:true,mode:0o700});
 try{const s=await lstat(final);requireValue(s.isFile()&&!s.isSymbolicLink()&&await readFile(final,'utf8')===content,'Existing prepared file differs: '+path);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=final+'.pending-'+randomUUID(),h=await open(temp,'wx',0o600);
 try{await h.writeFile(content,'utf8');await h.sync();await h.close();try{await link(temp,final);}catch(e){if(e.code!=='EEXIST')throw e;requireValue(await readFile(final,'utf8')===content,'Concurrent prepared file differs.');}const d=await open(dirname(final),'r');try{await d.sync();}finally{await d.close();}}finally{await h.close().catch(()=>{});await unlink(temp).catch(()=>{});}
}
export async function prepareDirectory({capturePath,mappingPath,outputDirectory,previousCapturePath,sourceIdsPath,pipelineOptions={}}){
 const capture=JSON.parse(await readFile(resolve(capturePath),'utf8')),mapping=JSON.parse(await readFile(resolve(mappingPath),'utf8')),prepared=prepareProviderMigration({capture,mapping}),root=resolve(outputDirectory);
 await mkdir(root,{recursive:true,mode:0o700});const state=await lstat(root);requireValue(state.isDirectory()&&!state.isSymbolicLink(),'Use a real private output directory.');
 for(const f of prepared.files)await save(root,f.path,f.content);
 await save(root,'PREPARED.json',json(prepared.manifest));
 if(previousCapturePath){const previous=JSON.parse(await readFile(resolve(previousCapturePath),'utf8'));await save(root,'population-change.json',json(compareCapturePopulations({before:previous,after:capture})));}
 if(sourceIdsPath){const sourceIds=JSON.parse(await readFile(resolve(sourceIdsPath),'utf8')),input=bindProviderPipeline(prepared,sourceIds,pipelineOptions);await save(root,'pipeline-input.json',json(input));}
 return {operationId:capture.operationId,directory:root,files:prepared.files.length,manifest:digest(json(prepared.manifest)),tables:prepared.manifest.tables.map(t=>({name:t.name,sourceRows:t.sourceRows,expectedRows:t.expectedRows}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [capturePath,mappingPath,outputDirectory,...rest]=process.argv.slice(2);if(!capturePath||!mappingPath||!outputDirectory)throw Error('Usage: node prepare-provider.mjs capture.json mapping.json output-directory [--previous capture.json] [--source-ids actual-source-ids.json]');
 const options={capturePath,mappingPath,outputDirectory};
 while(rest.length){const k=rest.shift(),v=rest.shift();if(k==='--previous')options.previousCapturePath=v;else if(k==='--source-ids')options.sourceIdsPath=v;else throw Error('Unknown original preparation option.');}
 console.log(json(await prepareDirectory(options)));
}
