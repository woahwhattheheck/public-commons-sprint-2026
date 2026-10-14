#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import publication from '../source/source-publication.cjs';
import recorder from '../source/delivery-recorder.cjs';
const toolRoot=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==5)throw Error('Usage: node native/record-delivery.mjs ORIGINAL_SOURCE_DIRECTORY DELIVERY_INPUT_JSON NEW_OUTPUT_DIRECTORY');
const source=path.resolve(process.argv[2]),inputPath=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);
if(output===source||output.startsWith(source+path.sep))throw Error('Use a new output directory outside the original source');
const inputBody=await fs.readFile(inputPath,'utf8');
const input=JSON.parse(inputBody);
const externalSources=[];
for(const [pathKey,valueKey]of [['original_payload_path','original_payload'],['raw_message_path','raw_message']]){
 if(input[pathKey]!==undefined){
  if(typeof input[pathKey]!=='string'||!input[pathKey].trim()||input[valueKey]!==undefined)throw Error('Supply exactly one complete '+valueKey+' source');
  const filename=path.resolve(path.dirname(inputPath),input[pathKey]),body=await fs.readFile(filename,'utf8');
  input[valueKey]=JSON.parse(body);externalSources.push({path:filename,body});
 }
}
if(typeof input.original_body_path!=='string'||!input.original_body_path.trim())throw Error('Supply original_body_path relative to the delivery input, or absolute');
const originalBody=await fs.readFile(path.resolve(path.dirname(inputPath),input.original_body_path),'utf8');
const bankBody=await fs.readFile(path.join(source,'complete-source.json'),'utf8');
const bank=JSON.parse(bankBody);
const hash=value=>{const bytes=Buffer.from(value);return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const files={},binaries={},disk=new Map();
function safe(value){if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe complete source path');return value;}
async function collect(directory,prefix=''){
 for(const item of await fs.readdir(directory,{withFileTypes:true})){
  const rel=(prefix?prefix+'/':'')+item.name;
  if(item.isDirectory())await collect(path.join(directory,item.name),rel);
  else if(item.isFile()){if(rel!=='complete-source.json')disk.set(rel,await fs.readFile(path.join(directory,item.name)));}
  else throw Error('Source contains a non-regular member: '+rel);
 }
}
await collect(source);
const originalMembers=[...disk.entries()].map(([path,body])=>({path,...hash(body)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
const sourceReal=await fs.realpath(source),outputParentReal=await fs.realpath(path.dirname(output));
const outputReal=path.join(outputParentReal,path.basename(output));
if(outputReal===sourceReal||outputReal.startsWith(sourceReal+path.sep))throw Error('Use an output outside the original source');
const toolPaths=['source/source-archive.cjs','source/SOURCE_ARCHIVES.md','native/pack-source.mjs','source/VALUE_FIRST_CUSTOMER_PRESENTATION.md','source/MARKDOWN_MIME_RECEIVING.md','source/PACK_SCOPED_LEAD_RECORDS.md','source/message-receipt.cjs','runtime/host/connected_contact_attachments.cjs','runtime/host/connected_archive_bytes.cjs','runtime/host/connected_mime.cjs','runtime/host/connected_gmail_raw.cjs','source/delivery-recorder.cjs','source/source-publication.cjs','native/record-delivery.mjs','native/reopen-cohort.mjs','source/RECORD_DELIVERY.md','native/materialize-source.py','source/MATERIALIZE_SOURCE.md'];
const toolBodies={};for(const rel of toolPaths)toolBodies[rel]=await fs.readFile(path.join(toolRoot,rel),'utf8');
const operation=await publication.createPublication({fs,path,hash,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'}).open({
 output,binding:{schema:'lead-actual-delivery.original-input.v1',source:sourceReal,input:hash(inputBody),external_sources:externalSources.map(({path,body})=>({path,...hash(body)})),original_body:hash(originalBody),complete_source:hash(bankBody),original_members:originalMembers,tool_members:toolPaths.map(path=>({path,...hash(toolBodies[path])}))},
 recordedAt:input.recorded_at||new Date().toISOString()
});
const sourceMembers=Array.isArray(bank.files)?bank.files:Object.entries(bank.files||{}).map(([path,content])=>({path,content}));
const seen=new Set();
for(const item of sourceMembers){
 const p=safe(item.path);if(seen.has(p))throw Error('Duplicate retained source member');seen.add(p);
 if(typeof item.content!=='string')throw Error('Source member must contain complete text');
 const expected=Buffer.from(item.content),actual=disk.get(p),id=hash(expected);
 if(item.sha256!==undefined&&(id.sha256!==item.sha256||id.bytes!==item.bytes))throw Error('Retained source member identity differs: '+p);
 if(!actual||!actual.equals(expected))throw Error('Original disk member differs: '+p);
 files[p]=item.content;disk.delete(p);
}
for(const item of bank.binary_files||[]){
 const p=safe(item.path);if(seen.has(p))throw Error('Duplicate binary source member');seen.add(p);
 const expected=Buffer.from(item.content_base64,'base64'),actual=disk.get(p),id=hash(expected);
 if(id.sha256!==item.sha256||id.bytes!==item.bytes||!actual||!actual.equals(expected))throw Error('Original binary member differs: '+p);
 binaries[p]=actual;disk.delete(p);
}
for(const [p,bytes]of disk){const text=bytes.toString('utf8');if(Buffer.from(text).equals(bytes))files[p]=text;else binaries[p]=bytes;}
const require=createRequire(path.join(source,'delivery-loader.cjs'));
const core=require(path.join(source,'runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs'));
const renderer=require(path.join(source,'source/customer-renderer.cjs')),markdown=require(path.join(source,'source/customer-markdown.cjs'));
// Rebuild the original prepared ZIPs from their retained complete members.
if(files['internal/preparation-config.json']){
 if(!files['internal/preparation-input.json'])throw Error('Original cohort preparation input is missing');
 const preparation=JSON.parse(files['internal/preparation-input.json']),config=preparation.config;
 const names=config.cohort_mode==='sample-only'?['sample']:['sample','paid'];
 const zip=require(path.join(source,'runtime/host/connected_zip.cjs'));
 for(const name of names){
  const stem=config.customer_filename_stems?.[name]||name;
  if(!/^[A-Za-z0-9_-]+$/.test(stem))throw Error('Unsafe original customer ZIP name');
  if(typeof preparation.guides?.[name]!=='string')throw Error('Original customer ZIP guide is missing');
  const members=['html','csv','json','md'].map(ext=>{const body=files['customer/'+name+'.'+ext];if(typeof body!=='string')throw Error('Original complete ZIP member missing');return {name:stem+'.'+ext,data:body};});
  members.push({name:'START_HERE.md',data:preparation.guides[name]});
  const expected=Buffer.from(zip.packStoredZip(members,{timestamp:config.prepared_at})),p='customer/'+stem+'.zip';
  const retained=binaries[p]||(files[p]!==undefined?Buffer.from(files[p]):null);
  if(retained&&!retained.equals(expected))throw Error('Original complete customer ZIP differs: '+p);
  delete files[p];binaries[p]=expected;
 }
}
const portable='runtime/tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs';
const coreOptions=files[portable]?{deliveryFeedback:require(path.join(source,portable)).createPortableGmail().feedback.previewLeadDeliveryFeedback}:{};
const result=recorder.recordDelivery(files,{...input,recorded_at:operation.recorded_at},originalBody,{core,renderer,markdown,hash,binaries,coreOptions});
const originalBankPath='history/source-editions/'+hash(bankBody).sha256+'/complete-source.json';
if(binaries[originalBankPath]||(result.files[originalBankPath]!==undefined&&result.files[originalBankPath]!==bankBody))throw Error('Original full source predecessor collision');
result.files[originalBankPath]=bankBody;
function adoptTool(rel,body){
 if(binaries[rel])throw Error('Delivery tool path collides with an original binary: '+rel);
 const previous=result.files[rel];
 if(previous!==undefined&&previous!==body){
  const retained='history/delivery-tool-predecessors/'+hash(previous).sha256+'/'+rel;
  if(binaries[retained]||(result.files[retained]!==undefined&&result.files[retained]!==previous))throw Error('Complete predecessor source collision: '+rel);
  result.files[retained]=previous;
 }
 result.files[rel]=body;
}
for(const rel of toolPaths)adoptTool(rel,toolBodies[rel]);
if(result.files['native/reopen.mjs']!==undefined)adoptTool('native/reopen.mjs',toolBodies['native/reopen-cohort.mjs']);
const manifest={schema:'lead-cohort.source-members.v1',files:Object.entries(result.files).filter(([p])=>p!=='internal/source-manifest.json').map(([p,body])=>({path:p,...hash(body)})),binary_files:Object.entries(binaries).map(([p,bytes])=>({path:p,...hash(bytes)}))};
result.files['internal/source-manifest.json']=JSON.stringify(manifest,null,2)+'\n';
const members=Array.isArray(bank.files)?Object.entries(result.files).map(([p,content])=>({path:p,content,...hash(content)})):result.files;
const complete={...bank,record_sha256:result.record.sha256,files:members,binary_files:Object.entries(binaries).map(([p,bytes])=>({path:p,...hash(bytes),content_base64:bytes.toString('base64')}))};
const completeBody=JSON.stringify(complete,null,2)+'\n';
const committed=await operation.publish([
 ...Object.entries(result.files).map(([path,body])=>({path,body})),
 ...Object.entries(binaries).map(([path,body])=>({path,body})),
 {path:'complete-source.json',body:completeBody}
]);
console.log(JSON.stringify({output,publication:committed,record_sha256:result.record.sha256,operations:result.operations.length,deliveries:result.record.deliveries.length,provider_id:result.provider_id,delivery_added:result.delivery_added,receipt_added:result.receipt_added,customer_files:result.customer_files,files:Object.keys(result.files).length,binary_files:Object.keys(binaries).length,source:hash(completeBody)},null,2));
