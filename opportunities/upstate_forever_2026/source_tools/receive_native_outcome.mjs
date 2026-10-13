#!/usr/bin/env node
// Receive the maintained edition-5 reader without changing its scientific source.
// Uses only local original files and Node's standard library. No model execution.
import {readFile,writeFile,mkdir,mkdtemp,copyFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const EXPECTED={
 'native-outcome-data.mjs':'f7f19f4a47e68a529eda2a31ff5f5cb14802ce2d7aece6e91578be2fa0017282',
 'native-outcome-html.mjs':'0bf832c8e57f8293cfe4ed933b381ed4409f3b86f70096738581a74929dfecab',
 'native-outcome-runtime.mjs':'f25caed04ccbf3ee7b79e6a922e1178f4b861862a231e5774577ce4aa8e4b167',
 'build-native-outcome-reading.mjs':'4184a4bf1e5e92d8ea4cf4d19208f9e2e871e3d2b2885b8b444c904d0b35060e',
 'NATIVE_OUTCOME_READING.md':'0016067c3c22ddca1b89b2968c034ee7d5f51bd8d91a8e5106d93c7293a0e7d7',
 'native-outcome-bindings.json':'9e28e6ad302a3e59fb7d1db364b9fd3f6f26388554a123c2ff23ed534e81138a',
 'completed-native-consumer-packet.json':'75d157b8540900cd97d42f35a1ca48de2f7dd33dc6153eecf7b27fb7eeaea572'
};
const PATCHES={
 'native-outcome-html.mjs':[
  ['.status{min-height:1.5em}.links{','.status{min-height:1.5em}#packetIdentity{display:block;max-width:100%;overflow-wrap:anywhere}.links{'],
  ['@media print{.controls,.actions,.record button{display:none}main{max-width:none;padding:0}.scroll{overflow:visible}table{font-size:8pt}details{break-inside:avoid}a{color:inherit}}','@media print{html{font-size:10pt;line-height:1.35}.controls,.actions,button,#status{display:none}main{max-width:none;padding:0}h1{font-size:20pt}p{margin:.5em 0}.numbers{gap:16px;margin:12px 0}.numbers strong{font-size:14pt}.scroll{overflow:visible}table{font-size:8pt}thead{display:table-header-group}tr{break-inside:avoid}.scroll tr>:last-child{display:none}details{break-inside:avoid}a{color:inherit}}']
 ],
 'native-outcome-runtime.mjs':[
  ['   const compressed=Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));',"   if(!globalThis.crypto?.subtle)throw Error('This browser context cannot verify the complete packet. Open index.html in a regular browser window, or use the unchanged completed-native-consumer-packet.json included in the package.');\n   const compressed=Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));"]
 ]
};
async function receive(source,output){
 source=path.resolve(source);output=path.resolve(output);
 if(output===source||output.startsWith(source+path.sep)||source.startsWith(output+path.sep))throw Error('Use independent source and output directories');
 try{await lstat(output);throw Error('Choose a new output directory; preserve existing received editions');}catch(e){if(e.code!=='ENOENT')throw e;}
 const originals={};
 for(const [name,expected]of Object.entries(EXPECTED)){
  const file=path.join(source,name),st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink())throw Error('Select the original regular source: '+name);
  const bytes=await readFile(file);if(sha(bytes)!==expected)throw Error('Compose the current source instead of replacing unknown bytes: '+name);
  originals[name]=bytes;
 }
 const packet=JSON.parse(originals['completed-native-consumer-packet.json']);
 const members=packet.source.files,seen=new Set();
 for(const item of members){
  if(typeof item.path!=='string'||item.path.includes('\\')||path.isAbsolute(item.path)||item.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(item.path))throw Error('Invalid original source-member path');
  seen.add(item.path);const bytes=Buffer.from(item.content,'utf8');
  if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('Original source member differs: '+item.path);
 }
 await mkdir(path.dirname(output),{recursive:true});
 const staging=await mkdtemp(path.join(path.dirname(output),'.native-outcome-source-'));
 const receivedSource={};
 for(const [name,original]of Object.entries(originals)){
  let bytes=original;
  if(PATCHES[name]){let text=bytes.toString('utf8');for(const [before,after]of PATCHES[name]){if(text.split(before).length!==2)throw Error('Source seam differs: '+name);text=text.replace(before,after);}bytes=Buffer.from(text);}
  await writeFile(path.join(staging,name),bytes,{flag:'wx'});
  receivedSource[name]={bytes:bytes.length,sha256:sha(bytes),original_sha256:EXPECTED[name]};
 }
 const {main}=await import(pathToFileURL(path.join(staging,'build-native-outcome-reading.mjs')).href);
 const built=await main([path.join(staging,'completed-native-consumer-packet.json'),path.join(staging,'native-outcome-bindings.json'),output]);
 for(const name of Object.keys(originals))if(!['completed-native-consumer-packet.json','native-outcome-bindings.json'].includes(name))await copyFile(path.join(staging,name),path.join(output,name));
 for(const item of members){const file=path.join(output,'retained-source',item.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,item.content,{flag:'wx'});}
 const receipt={schema:'upstate.native-outcome-receiving/v1',operation:'ECO-SPRINT-INTEGRATION-2C90',received_at:new Date().toISOString(),source_commit:'ef84a7e36f97d9458c5dfbb5d53506e94019fbbd',source_bank_edition:5,source_directory:source,staging_directory:staging,output_directory:output,opening:'index.html',project_id:built.identity.project_id,packet:built.packet,source_files:receivedSource,retained_source_members:members.map(({path,bytes,sha256})=>({path,bytes,sha256})),result_files:built.files,counts:{native_selections:built.selections,landcover_contrasts:built.landcover_quantity_contrasts,parameter_contrasts:built.parameter_quantity_contrasts},repairs:['Wrap the complete packet identity at narrow widths','Retain readable print columns, repeat table headers and keep rows together','Explain unavailable WebCrypto without disabling packet verification'],native_executions:0};
 await writeFile(path.join(output,'RECEIVING.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 await writeFile(path.join(output,'START_HERE.md'),`# Completed native headwaters: received reader\n\nOpen index.html in a regular current browser. This is the maintained edition-5 reader in its ordinary unwrapped build form, with narrow-footer, print and unsupported-context message repairs. It is not the earlier 237,156-byte wrapper. RECEIVING.json names every current file and the unchanged original packet.\n\nUse Read, Parameter member, Land-cover scenario and Quantity; Inspect original; download displayed rows or individual records. The full original packet and reading data are also ordinary JSON files beside the reader. An embedded browser without WebCrypto displays a direct explanation instead of skipping checksum verification.\n\nThe case is the original simulated 1,296-hectare square, separate from the regional Upper Savannah study. All twelve completed native selections, 24 land-cover contrasts and nine parameter contrasts remain unchanged. The twelve original source members are extracted without modification under retained-source/. Joint Decisions bodies and operation-stage receipts are absent from this carrier, so those two views remain empty.\n\nNATIVE_OUTCOME_READING.md preserves the complete source-owner guide and its historical wrapper/checkpoint references. The owner's subsequent continuation released the old sprint cutoff and meeting reservation. All other owner controls remain.\n\nTo rebuild this received presentation using its existing local Node runtime:\n\n\`\`\`sh\nnode build-native-outcome-reading.mjs completed-native-consumer-packet.json native-outcome-bindings.json NEW_OUTPUT_DIRECTORY\n\`\`\`\n\nThis command renders the retained results; it does not execute a scientific model. Keep the original received directory and choose a fresh sibling output.\n`,{flag:'wx'});
 return receipt;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.length!==4){console.error('Usage: node receive_native_outcome.mjs ORIGINAL_EDITION5_DIRECTORY NEW_OUTPUT_DIRECTORY');process.exitCode=2;}
 else receive(...process.argv.slice(2)).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
export {receive};
