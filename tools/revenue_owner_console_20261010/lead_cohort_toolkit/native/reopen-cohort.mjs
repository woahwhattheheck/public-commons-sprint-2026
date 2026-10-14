#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import core from '../runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs';
import renderer from '../source/customer-renderer.cjs';
import markdown from '../source/customer-markdown.cjs';
import recorder from '../source/delivery-recorder.cjs';
import publication from '../source/source-publication.cjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==3&&process.argv.length!==4)throw Error('Usage: node native/reopen-cohort.mjs NEW_OUTPUT_DIRECTORY [native/operation-history.json|internal/operation-history.json]');
const output=path.resolve(process.argv[2]),requestedHistory=process.argv[3];
const INDEX='internal/delivery-receipts/index.json',RECORD='internal/working-record.json',HISTORIES=['native/operation-history.json','internal/operation-history.json'];
if(requestedHistory!==undefined&&!HISTORIES.includes(requestedHistory))throw Error('Use an original operation-history path');
const hash=value=>{const bytes=Buffer.from(value);return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
function safe(value){if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe complete source path');return value;}
async function optional(relative){try{return await fs.readFile(path.join(root,safe(relative)),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}}
const sourceBody=await optional('complete-source.json'),files={},binaries={},seen=new Set();
if(sourceBody!==undefined){
 const bank=JSON.parse(sourceBody),members=Array.isArray(bank.files)?bank.files:Object.entries(bank.files||{}).map(([path,content])=>({path,content}));
 for(const member of members){
  const p=safe(member.path);if(seen.has(p))throw Error('Duplicate source member');seen.add(p);
  if(typeof member.content!=='string')throw Error('Full original text source is required');
  const actual=await fs.readFile(path.join(root,p)),expected=Buffer.from(member.content),id=hash(actual);
  if(!actual.equals(expected)||member.sha256!==undefined&&(member.sha256!==id.sha256||member.bytes!==id.bytes))throw Error('Original complete source differs: '+p);
  files[p]=member.content;
 }
 for(const member of bank.binary_files||[]){
  const p=safe(member.path);if(seen.has(p))throw Error('Duplicate binary source member');seen.add(p);
  const expected=Buffer.from(member.content_base64,'base64'),actual=await fs.readFile(path.join(root,p)),id=hash(actual);
  if(!actual.equals(expected)||member.sha256!==id.sha256||member.bytes!==id.bytes)throw Error('Original binary source differs: '+p);
  binaries[p]=actual;
 }
 // An undeclared index must not silently replace the selected complete source.
 const diskIndex=await optional(INDEX);
 if(diskIndex!==files[INDEX])throw Error('Receipt index differs from the complete source');
}else{
 for(const p of [RECORD,INDEX,...HISTORIES]){const body=await optional(p);if(body!==undefined)files[p]=body;}
 for(const item of await fs.readdir(path.join(root,'customer'),{withFileTypes:true})){
  if(item.isFile()&&/\.(json|html|csv|md)$/.test(item.name))files['customer/'+item.name]=await fs.readFile(path.join(root,'customer',item.name),'utf8');
 }
 const index=files[INDEX]===undefined?null:JSON.parse(files[INDEX]);
 if(index?.entries)for(const row of index.entries){
  for(const p of [row.message_path,row.body_path,row.original_payload_path,row.raw_path].filter(x=>x!==undefined)){
   if(!/^internal\/delivery-receipts\/[a-f0-9]{1,64}\/(sent-message\.json|first-email\.txt|original-payload\.json|sent-raw\.json)$/i.test(p))throw Error('Unsafe receipt path');
   files[p]=await fs.readFile(path.join(root,p),'utf8');
  }
  for(const item of row.message_content?.attachments||[]){
   const p=safe(item.source_path),actual=await fs.readFile(path.join(root,p));
   if(files[p]===undefined)binaries[p]=actual;
  }
 }
}
const receiptBody=files[INDEX],index=receiptBody===undefined?null:JSON.parse(receiptBody);
if(receiptBody!==undefined&&(!index||index.schema!=='lead-cohort.gmail-delivery-receipts.v1'||!Array.isArray(index.entries)))throw Error('Invalid original delivery receipt index');
const indexed=[...new Set((index?.entries||[]).map(r=>r.history_path))];
if(indexed.some(p=>!HISTORIES.includes(p)))throw Error('Use an original operation-history path');
const available=HISTORIES.filter(p=>typeof files[p]==='string');
const selected=requestedHistory||(indexed.length===1?indexed[0]:available.length===1?available[0]:undefined);
if(!selected)throw Error('Select the original history when more than one is retained');
const require=createRequire(path.join(root,'reopen-loader.cjs'));
const portable='runtime/tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs';
const coreOptions=files[portable]?{deliveryFeedback:require(path.join(root,portable)).createPortableGmail().feedback.previewLeadDeliveryFeedback}:{};
const deps={core,renderer,markdown,hash,binaries,coreOptions};
const {record,operations,history_path}=recorder.replay(files,core,selected,coreOptions);
const receiptResult=recorder.verifyReceipts(files,deps);
const count=recorder.exportedFiles(files,record,deps);
const assembly=core.createLeadFulfillmentAssembly({});
assembly.receive(record,{operationId:record.pack.id+'-native-independent-receive',asOf:record.editions[0]?.prepared_at||'2026-01-01T00:00:00Z'});
if(JSON.stringify(assembly.export({packId:record.pack.id,format:'working-record'}).value)!==JSON.stringify(record))throw Error('Independent original record differs');
const plan=[],manifest=[];
for(const [p,body]of Object.entries(files)){
 if(!/^customer\/.+\.json$/.test(p))continue;
 let customer;try{customer=JSON.parse(body);}catch{continue;}
 if(customer?.version!==assembly.export({packId:record.pack.id,editionId:record.editions[0].id,format:'json'}).value.version)continue;
 for(const ext of ['json','html','csv','md']){
  const original=p.slice(0,-5)+'.'+ext,filename=safe(original.slice('customer/'.length)),value=files[original];
  if(typeof value!=='string')throw Error('Complete customer export is missing');
  plan.push({path:filename,body:value});manifest.push({path:filename,...hash(value)});
 }
}
if(plan.length!==count)throw Error('Original customer output groups differ');
const summary={schema:'lead-cohort.native-reopen.v2',record_sha256:record.sha256,operations:operations.length,history_path,receipts:receiptResult.receipts,files:manifest};
plan.push({path:'working-record.json',body:JSON.stringify(record,null,2)+'\n'},{path:'manifest.json',body:JSON.stringify(summary,null,2)+'\n'});
const sourceReal=await fs.realpath(root),outputReal=path.join(await fs.realpath(path.dirname(output)),path.basename(output));
if(outputReal===sourceReal||outputReal.startsWith(sourceReal+path.sep))throw Error('Use an independent output outside the source');
const publisher=publication.createPublication({fs,path,hash,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'});
const operation=await publisher.open({output,completionPath:'manifest.json',binding:{schema:'lead-native-reopen.v2',source:sourceReal,source_sha256:sourceBody===undefined?null:hash(sourceBody).sha256,history_path,members:Object.entries(files).map(([path,body])=>({path,...hash(body)})),binaries:Object.entries(binaries).map(([path,body])=>({path,...hash(body)})),tool:hash(await fs.readFile(fileURLToPath(import.meta.url)))},recordedAt:record.editions[0]?.prepared_at||'2026-01-01T00:00:00Z'});
const published=await operation.publish(plan);
console.log(JSON.stringify({output,...summary,publication:published},null,2));
