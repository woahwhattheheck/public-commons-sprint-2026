/** Full original source returns through the existing Measurements command line. */
import fs from 'node:fs';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {handbackCatalog,previewHandback,publishHandback,readManifest,handbackBundle,receiveHandbackBytes} from './source_handback.mjs';
export async function runSourceHandbackCLI(command,options,directory){
 const w=new MeasurementWorkspace(directory);
 const output=value=>{const raw=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';if(options.output)fs.writeFileSync(options.output,raw);else process.stdout.write(raw);};
 try{
  if(command==='list')return output(handbackCatalog(w));
  if(command==='preview'||command==='publish'){if(!options.selection)throw Error('Use --selection complete-selection.json');
   const input=JSON.parse(fs.readFileSync(options.selection,'utf8'));
   return output(command==='preview'?previewHandback(w,input):publishHandback(w,input));}
  if(command==='inspect')return output(readManifest(w,options.id));
  if(command==='bundle'){if(!options.output)throw Error('Use --output returned.zip');
   const result=handbackBundle(w,options.id);fs.writeFileSync(path.resolve(options.output),Buffer.from(result.contentBase64,'base64'));
   return process.stdout.write(JSON.stringify({filename:options.output,bytes:result.bytes,sha256:result.sha256})+'\n');}
  if(command==='receive'){if(!options.file)throw Error('Use --file complete-source-return.zip');return output(receiveHandbackBytes(w,fs.readFileSync(options.file)));}
  throw Error('Unknown source-handback command: '+command);
 }finally{w.close();}
}
