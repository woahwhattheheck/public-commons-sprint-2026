#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import publication from '../source/source-publication.cjs';
import core from '../runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs';
import renderer from '../source/customer-renderer.cjs';
import markdown from '../source/customer-markdown.cjs';
import builder from '../source/cohort-builder.cjs';
import message from '../source/value-message.cjs';
import zip from '../runtime/host/connected_zip.cjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==4)throw Error('Usage: node native/prepare-cohort.mjs PREPARATION_INPUT_JSON NEW_OUTPUT_DIRECTORY');
const requestBody=await fs.readFile(path.resolve(process.argv[2]),'utf8');
const request=JSON.parse(requestBody);
const prepared=builder.compile(request.cohort,request.config,{core,renderer,markdown});
const output=path.resolve(process.argv[3]);
const kinds=builder.editionNames(request.config);
for(const kind of kinds){
 const stem=request.config.customer_filename_stems?.[kind]||kind;
 if(!/^[A-Za-z0-9_-]+$/.test(stem))throw Error('Customer filename stem must use letters, digits, underscores or hyphens');
}
const files={...prepared.customerFiles};
if(request.message!==undefined){
 if(!request.message||typeof request.message!=='object'||!kinds.includes(request.message.edition))throw Error('Select one complete prepared sample or paid edition for the message');
 const editionText=files['customer/'+request.message.edition+'.json'];
 const value=message.compose({editionText,recipe:request.message.recipe});
 message.receive(value);
 for(const member of message.files(value))files['message/'+member.path]=member.content;
}
async function collect(directory,relative){
 const entries=await fs.readdir(directory,{withFileTypes:true});
 for(const item of entries){
  const rel=relative+'/'+item.name,absolute=path.join(directory,item.name);
  if(item.isDirectory())await collect(absolute,rel);
  else if(item.isFile())files[rel]=await fs.readFile(absolute,'utf8');
  else throw Error('Runtime source must contain regular files: '+rel);
 }
}
await collect(path.join(root,'runtime'),'runtime');
for(const rel of ['source/source-archive.cjs','source/SOURCE_ARCHIVES.md','native/pack-source.mjs','source/VALUE_FIRST_CUSTOMER_PRESENTATION.md','source/MARKDOWN_MIME_RECEIVING.md','source/PACK_SCOPED_LEAD_RECORDS.md','ROUTE_RECOVERY.md','course/route-recovery.cjs','source/customer-renderer.cjs','source/customer-markdown.cjs','source/cohort-builder.cjs','source/regenerate.mjs','native/prepare-cohort.mjs','native/reopen-cohort.mjs','source/PREPARE_COHORT.md','source/delivery-recorder.cjs','source/message-receipt.cjs','source/value-message.cjs','source/VALUE_IN_MESSAGE.md','native/compose-message.mjs','source/source-publication.cjs','source/MATERIALIZE_SOURCE.md','native/record-delivery.mjs','source/RECORD_DELIVERY.md','native/materialize-source.py'])files[rel]=await fs.readFile(path.join(root,rel),'utf8');
files['native/reopen.mjs']=files['native/reopen-cohort.mjs'];
files['internal/preparation-input.json']=JSON.stringify(request,null,2)+'\n';
for(const rel of ['internal/retained-parent-qualification-input.json','internal/independent-source-review.json']){
 try{files[rel]=await fs.readFile(path.join(root,rel),'utf8');}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
files['internal/preparation-config.json']=JSON.stringify({...request.config,prepared_by:request.cohort.prepared_by},null,2)+'\n';
files['internal/reviewed-research-cohort.json']=JSON.stringify(request.cohort,null,2)+'\n';
files['internal/source-input.json']=JSON.stringify(prepared.input,null,2)+'\n';
files['internal/working-record.json']=JSON.stringify(prepared.record,null,2)+'\n';
files['native/operation-history.json']=JSON.stringify(prepared.operations,null,2)+'\n';
const guides=request.guides||{};
for(const kind of kinds)if(typeof guides[kind]!=='string'||!guides[kind].trim())throw Error('Supply a readable '+kind+' customer guide');
files['customer/START_HERE.md']='# '+request.cohort.customer+' — customer files\n\n'+kinds.map(kind=>guides[kind]).join('\n\n')+'\n';
files['README.md']='# '+request.cohort.customer+' — complete prepared source\n\nPrepared '+request.config.prepared_at+' by '+request.cohort.prepared_by+'.\n\nOpen customer/START_HERE.md. '+(kinds.length===1?'The original maintained core and customer renderer generate the complete free edition. Run node native/reopen.mjs NEW_OUTPUT_DIRECTORY to replay the original operations and independently receive/export the exact record and four customer files.':'The original maintained core and customer renderer generate both complete editions. Run node native/reopen.mjs NEW_OUTPUT_DIRECTORY to replay the original operations and independently receive/export the exact record and eight customer files.')+' Run node source/regenerate.mjs to regenerate all HTML, CSV and Markdown. Research and configuration are retained under internal/. Return concrete recipient-view findings to the original case.'+(request.message?' The exact selected edition also has a complete unsent body under message/; inspect it before any separately authorized send.':'')+'\n';
const identify=body=>{const b=Buffer.from(body);return {bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
const archives=[],binaryFiles=[];
for(const kind of kinds){
 const stem=request.config.customer_filename_stems?.[kind]||kind;
 if(!/^[A-Za-z0-9_-]+$/.test(stem))throw Error('Customer filename stem must use letters, digits, underscores or hyphens');
 const bytes=zip.packStoredZip([...['html','csv','json','md'].map(ext=>({name:stem+'.'+ext,data:files['customer/'+kind+'.'+ext]})),{name:'START_HERE.md',data:guides[kind]}],{timestamp:request.config.prepared_at});
 const filename=stem+'.zip';binaryFiles.push({path:'customer/'+filename,body:Buffer.from(bytes)});archives.push({filename,...identify(bytes)});
}
files['internal/source-manifest.json']=JSON.stringify({schema:'lead-cohort.source-members.v1',files:Object.entries(files).map(([path,body])=>({path,...identify(body)})),binary_files:binaryFiles.map(({path,body})=>({path,...identify(body)}))},null,2)+'\n';
const bank={schema:'lead-cohort.complete-source.v1',prepared_at:request.config.prepared_at,original_case:request.config.original_case||request.config.pack.customer.case_id,pack_id:prepared.record.pack.id,record_sha256:prepared.record.sha256,files,binary_files:binaryFiles.map(({path,body})=>({path,...identify(body),content_base64:body.toString('base64')}))};
const body=JSON.stringify(bank,null,2)+'\n';
const operation=await publication.createPublication({fs,path,hash:identify,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'}).open({
 output,binding:{schema:'lead-cohort.prepare-publication.v1',input:identify(requestBody),complete_source:identify(body)},recordedAt:request.config.prepared_at
});
const committed=await operation.publish([...Object.entries(files).map(([path,body])=>({path,body})),...binaryFiles,{path:'complete-source.json',body}]);
console.log(JSON.stringify({output,publication:committed,source:identify(body),record_sha256:prepared.record.sha256,leads:prepared.record.leads.length,editions:prepared.record.editions.length,files:Object.keys(files).length,archives},null,2));
