#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import receiver from '../source/receive-delivery-feedback.cjs';
import publication from '../source/source-publication.cjs';
const toolRoot=fileURLToPath(new URL('../',import.meta.url));
const runtime='runtime/tools/revenue_owner_console_20261010';
if(process.argv.length!==5)throw Error('Usage: node native/receive-delivery-feedback.mjs ORIGINAL_SOURCE_DIRECTORY ORIGINAL_FEEDBACK_INPUT_JSON NEW_OUTPUT_DIRECTORY');
const source=await fs.realpath(path.resolve(process.argv[2])),inputPath=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);
const outputReal=path.join(await fs.realpath(path.dirname(output)),path.basename(output));
if(outputReal===source||outputReal.startsWith(source+path.sep))throw Error('Use a new output directory outside the original source');
const hash=value=>{const bytes=Buffer.from(value);return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const json=value=>JSON.stringify(value,null,2)+'\n';
function safe(value){if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||value.includes(':')||/[\x00-\x1f\x7f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Use original ordinary relative source paths');return value;}
const inputBody=await fs.readFile(inputPath,'utf8'),input=JSON.parse(inputBody);
const bankBody=await fs.readFile(path.join(source,'complete-source.json'),'utf8'),bank=JSON.parse(bankBody),files=Object.create(null),binaries=Object.create(null),seen=new Set(),disk=new Map();
async function walk(directory,prefix=''){for(const item of await fs.readdir(directory,{withFileTypes:true})){const name=safe((prefix?prefix+'/':'')+item.name);if(item.isDirectory())await walk(path.join(directory,item.name),name);else if(item.isFile()){if(name!=='complete-source.json')disk.set(name,await fs.readFile(path.join(directory,item.name)));}else throw Error('Source member is not an ordinary file: '+name);}}
await walk(source);
const originalMembers=[...disk.entries()].map(([path,bytes])=>({path,...hash(bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
const textMembers=Array.isArray(bank.files)?bank.files:Object.entries(bank.files||{}).map(([path,content])=>({path,content}));
for(const member of textMembers){const p=safe(member.path);if(seen.has(p)||typeof member.content!=='string')throw Error('Duplicate or incomplete source member');seen.add(p);const expected=Buffer.from(member.content),actual=disk.get(p),id=hash(expected);if(!actual||!actual.equals(expected)||(member.sha256!==undefined&&(member.sha256!==id.sha256||member.bytes!==id.bytes)))throw Error('Complete original source differs: '+p);files[p]=member.content;disk.delete(p);}
for(const member of bank.binary_files||[]){const p=safe(member.path);if(seen.has(p)||typeof member.content_base64!=='string')throw Error('Duplicate or incomplete binary source');seen.add(p);const expected=Buffer.from(member.content_base64,'base64'),actual=disk.get(p),id=hash(expected);if(expected.toString('base64')!==member.content_base64||!actual||!actual.equals(expected)||member.bytes!==id.bytes||member.sha256!==id.sha256)throw Error('Complete original binary differs: '+p);binaries[p]=actual;disk.delete(p);}
// Preserve ordinary additions exactly; declared members above must still match.
for(const [p,bytes]of disk){const text=bytes.toString('utf8');if(Buffer.from(text,'utf8').equals(bytes))files[p]=text;else binaries[p]=bytes;}
const toolPaths=["source/contact-route-triage.cjs","native/triage-contact-route.mjs","source/CONTACT_ROUTE_TRIAGE.md","course/contact-route-triage.cjs","course/contact-route-example.json","source/receive-delivery-feedback.cjs","native/receive-delivery-feedback.mjs","source/DELIVERY_FEEDBACK.md","source/source-archive.cjs","source/SOURCE_ARCHIVES.md","native/pack-source.mjs","source/VALUE_FIRST_CUSTOMER_PRESENTATION.md","source/MARKDOWN_MIME_RECEIVING.md","source/PACK_SCOPED_LEAD_RECORDS.md","ROUTE_RECOVERY.md","course/route-recovery.cjs","source/message-receipt.cjs","runtime/host/connected_contact_attachments.cjs","runtime/host/connected_archive_bytes.cjs","runtime/host/connected_mime.cjs","runtime/host/connected_gmail_raw.cjs","source/delivery-recorder.cjs","source/source-publication.cjs","native/record-delivery.mjs","native/reopen-cohort.mjs","source/RECORD_DELIVERY.md","native/materialize-source.py","source/MATERIALIZE_SOURCE.md","runtime/tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs","runtime/tools/revenue_owner_console_20261010/lead_delivery_feedback_core.cjs","runtime/tools/revenue_owner_console_20261010/native_delivery_report_core.cjs","runtime/tools/revenue_owner_console_20261010/gmail_native_messages.cjs","runtime/tools/revenue_owner_console_20261010/native_google_groups_failure.cjs","runtime/tools/revenue_owner_console_20261010/native_google_attachment_failure.cjs","runtime/tools/revenue_owner_console_20261010/native_google_sending_limit_failure.cjs"];
const toolBodies={};for(const p of toolPaths)toolBodies[p]=await fs.readFile(path.join(toolRoot,p),'utf8');
const op=await publication.createPublication({fs,path,hash,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'}).open({output,binding:{schema:'lead-delivery-feedback.original-input.v1',source,input:hash(inputBody),complete_source:hash(bankBody),original_members:originalMembers,tool_members:toolPaths.map(path=>({path,...hash(toolBodies[path])}))},recordedAt:input.recorded_at});
const require=createRequire(path.join(source,'feedback-loader.cjs')),core=require(path.join(source,runtime,'lead_fulfillment_core.cjs')),customerRenderer=require(path.join(source,'source/customer-renderer.cjs')),customerMarkdown=require(path.join(source,'source/customer-markdown.cjs'));
const result=receiver.receiveFeedback(files,input,{binaries,core,customerRenderer,customerMarkdown});
for(const [p,body]of Object.entries(toolBodies)){const previous=result.files[p];if(binaries[p])throw Error('Tool path collides with binary source');if(previous!==undefined&&previous!==body){const history='history/feedback-tools/'+hash(previous).sha256+'/'+p;if(result.files[history]!==undefined&&result.files[history]!==previous)throw Error('Historical tool collision');result.files[history]=previous;}result.files[p]=body;}
const predecessor='history/source-editions/'+hash(bankBody).sha256+'/complete-source.json';if(result.files[predecessor]!==undefined&&result.files[predecessor]!==bankBody)throw Error('Complete predecessor collision');result.files[predecessor]=bankBody;
// Keep the exact input spelling and every prior receiving summary in the bank.
const originalInput='internal/delivery-status-inputs/'+hash(inputBody).sha256+'/request.json';
if(binaries[originalInput]||(result.files[originalInput]!==undefined&&result.files[originalInput]!==inputBody))throw Error('Original feedback input collision');
result.files[originalInput]=inputBody;
const summaryPath='feedback-receiving-result.json';
if(binaries[summaryPath])throw Error('Feedback result path collides with an original binary');
if(result.files[summaryPath]!==undefined){
 const previous=result.files[summaryPath],history='history/feedback-results/'+hash(previous).sha256+'/feedback-receiving-result.json';
 if(binaries[history]||(result.files[history]!==undefined&&result.files[history]!==previous))throw Error('Original feedback result collision');
 result.files[history]=previous;
}
const summary={schema:'lead-delivery-feedback.receiving.v1',operation_id:input.operation_id,received:result.received,record_sha256:result.record.sha256,history_path:result.history_path,operations:result.operations.length,feedback:result.preview.summary,delivery_states:result.delivery_states,input_source:hash(bankBody),original_input:{path:originalInput,...hash(inputBody)}};
result.files[summaryPath]=json(summary);
const manifest={schema:'lead-cohort.source-members.v1',files:Object.entries(result.files).filter(([p])=>p!=='internal/source-manifest.json').map(([path,body])=>({path,...hash(body)})),binary_files:Object.entries(binaries).map(([path,body])=>({path,...hash(body)}))};
result.files['internal/source-manifest.json']=json(manifest);
const finalBank={...bank,files:result.files,binary_files:Object.entries(binaries).map(([path,data])=>({path,...hash(data),content_base64:data.toString('base64')})),record_sha256:result.record.sha256};
const finalBody=json(finalBank);
const entries=[...Object.entries(result.files).map(([path,body])=>({path,body})),...Object.entries(binaries).map(([path,body])=>({path,body})),{path:'complete-source.json',body:finalBody}];
const published=await op.publish(entries);
console.log(json({output,...summary,complete_source:hash(finalBody),publication:published}));
