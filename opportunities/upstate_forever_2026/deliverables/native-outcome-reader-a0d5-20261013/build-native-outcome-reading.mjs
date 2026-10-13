#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {makeOutcomeView} from './native-outcome-data.mjs';
import {renderOutcomeHTML} from './native-outcome-html.mjs';
import {outcomeRuntime} from './native-outcome-runtime.mjs';

const sha256=x=>createHash('sha256').update(x).digest('hex');
function pointer(root,pointer){
 if(typeof pointer!=='string'||(pointer!==''&&!pointer.startsWith('/')))throw Error('Use an exact retained JSON pointer');
 let value=root;
 for(const part of pointer===''?[]:pointer.slice(1).split('/')){
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw Error('Selected embedded source is not JSON');}}
  const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
  if(!value||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,key))throw Error('Original packet member is absent: '+pointer);
  value=value[key];
 }
 if(typeof value==='string'){try{return JSON.parse(value);}catch{throw Error('Selected source is not JSON: '+pointer);}}
 return value;
}
async function main(args){
 if(args.length!==3)throw Error('Usage: node build-native-outcome-reading.mjs ORIGINAL_PACKET_JSON EXACT_BINDINGS_JSON NEW_OUTPUT_DIRECTORY');
 const [packetPath,bindingsPath,out]=args,bytes=await readFile(packetPath),text=bytes.toString('utf8');
 if(!Buffer.from(text,'utf8').equals(bytes))throw Error('Original packet is not valid UTF-8');
 const binding=JSON.parse(await readFile(bindingsPath,'utf8'));
 if(binding.schema!=='upstate.native-outcome-bindings/v1')throw Error('Select the complete original reading bindings');
 if(bytes.length!==binding.packet.bytes||sha256(bytes)!==binding.packet.sha256)throw Error('Original packet differs from selected bytes');
 const packet=JSON.parse(text),docs={};
 for(const k of ['report','plan','runs','receipt'])docs[k]=pointer(packet,binding.paths[k]);
 if(binding.paths.preview)docs.preview=pointer(packet,binding.paths.preview);
 if(docs.preview){for(const member of docs.receipt.files||[]){if(typeof member.content!=='string'||Buffer.byteLength(member.content,'utf8')!==member.bytes||sha256(Buffer.from(member.content,'utf8'))!==member.sha256)throw Error('Original retained member differs: '+member.path);}}
 if(binding.paths.course)docs.course=pointer(packet,binding.paths.course);
 if(binding.paths.joint_reports){if(!Array.isArray(binding.paths.joint_reports))throw Error('Joint report bindings must be an array of original JSON pointers');docs.jointReports=binding.paths.joint_reports.map(p=>pointer(packet,p));}
 const view=makeOutcomeView({...docs,packetIdentity:binding.packet,sourcePaths:binding.paths,links:binding.links||[]});
 const html=renderOutcomeHTML(view,text,{
  sha256,utf8:s=>Buffer.from(s,'utf8'),base64:b=>Buffer.from(b).toString('base64'),
  gzip:s=>gzipSync(Buffer.from(s,'utf8'),{level:9})
 },outcomeRuntime.toString());
 const files={
  'index.html':Buffer.from(html,'utf8'),
  'completed-native-consumer-packet.json':bytes,
  'native-outcome-reading.json':Buffer.from(JSON.stringify(view,null,2)+'\n','utf8'),
  'native-outcome-bindings.json':Buffer.from(JSON.stringify(binding,null,2)+'\n','utf8')
 };
 const manifest={schema:'upstate.native-outcome-delivery/v1',packet:binding.packet,identity:view.identity,
  source_files:Object.fromEntries(await Promise.all(['native-outcome-data.mjs','native-outcome-html.mjs','native-outcome-runtime.mjs','build-native-outcome-reading.mjs'].map(async name=>{const b=await readFile(new URL(name,import.meta.url));return [name,{bytes:b.length,sha256:sha256(b)}];}))),
  files:Object.fromEntries(Object.entries(files).map(([name,b])=>[name,{bytes:b.length,sha256:sha256(b)}])),
  selections:view.selections.length,landcover_quantity_contrasts:view.landcover.length,
  parameter_quantity_contrasts:view.parameter.length,joint_quantity_contrasts:view.joint.rows.length,scientific_computation:'No native run or numerical spatial aggregation; original retained quantities only.'};
 const output=path.resolve(out);await mkdir(output,{recursive:false});
 try{for(const [name,body] of Object.entries(files))await writeFile(path.join(output,name),body,{flag:'wx'});await writeFile(path.join(output,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});}
 catch(error){error.message+='; incomplete new output remains at '+output;throw error;}
 return {output,...manifest};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.stack);process.exitCode=1;});
}
export {pointer,main};
