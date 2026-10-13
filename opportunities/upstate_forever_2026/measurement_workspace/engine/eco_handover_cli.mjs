/** Existing CLI admission for complete native handovers; no independent scientific writer. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MeasurementWorkspace} from './workspace.mjs';
import {exportHandover,handoverChoices,handoverInfo,handoverFile,inspectHandover,readHandoverDocument} from './eco_handover.mjs';
import {publishExactFile} from './file_product.mjs';
import {copyVerified,fileDigest} from './large_io.mjs';
const text=file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file));
async function output(options,value){
 const raw=JSON.stringify(value,null,2)+'\n';
 if(options.output){await publishExactFile(options.output,Buffer.from(raw));process.stdout.write(JSON.stringify({output:path.resolve(options.output),...fileDigest(options.output)})+'\n');}
 else process.stdout.write(raw);
}
export async function runHandoverCLI(command,options,directory){
 if(command==='inspect'){
  if(!options.file||!options.output)throw Error('Use --file complete-handover.zip --output complete-source-inspection.json');
  return output(options,inspectHandover(path.resolve(options.file)));
 }
 if(command==='read'){
  if(!options.file||!options.selector||!options.output)throw Error('Use --file complete-handover.zip --selector exact-selector.json --output complete-original');
  const result=readHandoverDocument(path.resolve(options.file),JSON.parse(text(options.selector)),path.resolve(options.output));
  process.stdout.write(JSON.stringify({output:path.resolve(options.output),...result})+'\n');return;
 }
 const stat=fs.statSync(directory);if(!stat.isDirectory())throw Error('Select the existing Measurements workspace');
 const w=new MeasurementWorkspace(directory);
 try{
  if(command==='choices')return await output(options,handoverChoices(w));
  if(command==='status')return await output(options,handoverInfo(w,options.id));
  if(command==='export'){
   if(!options.file)throw Error('Choose the complete retained request with --file');
   if(options['native-workspace'])execFileSync(process.env.MEASUREMENTS_PYTHON||'python3',[fileURLToPath(new URL('../large_context.py',import.meta.url)),'capture',path.resolve(options['native-workspace']),directory],{stdio:['ignore','pipe','pipe']});
   return await output(options,await exportHandover(w,JSON.parse(text(options.file))));
  }
  if(command==='download'){
   if(!options.output)throw Error('Choose --output complete-handover.zip');
   const {file,result}=handoverFile(w,options.id);copyVerified(file,path.resolve(options.output),result.source);
   process.stdout.write(JSON.stringify({output:path.resolve(options.output),id:result.id,filename:result.filename,...fileDigest(options.output)})+'\n');return;
  }
  throw Error('Unknown handover command: '+command);
 }finally{w.close();}
}
