#!/usr/bin/env node
// MIT. Property Operations calls and complete file receiving through the original merchant clients.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {propertyActions,openPropertyClient,downloadPropertyExport,inspectPropertyExport,reopenPropertyExport} from './property-client.mjs';
const HELP=[
 'Property Operations agent interface','',
 '  property-mcp tools',
 '  property-mcp call --url MCP_URL --action ACTION --arguments PRIVATE_JSON [--workspace ALIAS] [--token-env NAME] [--output NEW_JSON]',
 '  property-mcp inspect --url MCP_URL --workspace ALIAS --export EXPORT_ID [--token-env NAME] [--output NEW_JSON]',
 '  property-mcp download --url MCP_URL --workspace ALIAS --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--token-env NAME] [--chunk-size BYTES] [--output NEW_JSON]',
 '  property-mcp reopen --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--output NEW_JSON]','',
 'tools shows the exact source-owned tool definitions. call accepts a short action or full merchant_property_ name.',
 'Prepare a native property change with one key, save the whole returned envelope, and invoke that same envelope.',
 'After a lost response, inspect_request reads the original operation. An ISSUED vendor request is never automatically sent again.',
 'Use file_import_prepare with the host alias and exact byte/hash declaration for incoming licensed files.',
 'Original publisher, release and buyer actions keep their native reviews, resources and account policies.',
 'Create an original package.export explicitly when an editable portable workspace is required.',
 'export_prepare then pins that existing export or an original property resource without changing native state.',
 'download resumes the same manifest and complete files. reopen verifies every file with all listeners closed.',''
].join('\n');
const fail=message=>{throw Object.assign(new Error(message),{code:'PROPERTY_CLI'});};
function options(args,allowed,required=[]){
 const value={};for(let i=0;i<args.length;i+=2){const k=args[i],v=args[i+1];
  if(!allowed.includes(k)||typeof v!=='string'||!v||Object.hasOwn(value,k))fail('Use each declared option once with its value.');value[k]=v;}
 if(required.some(k=>!Object.hasOwn(value,k)))fail('Supply the required options shown in help.');return value;
}
async function argumentsFile(path){
 const h=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=await h.stat({bigint:true});if(!a.isFile()||(a.mode&0o077n)!==0n||a.size>2097152n)fail('Use a private complete JSON argument file no larger than 2 MiB.');
  const raw=await h.readFile(),b=await h.stat({bigint:true});
  if(raw.length>2097152||['dev','ino','size','mtimeNs','ctimeNs'].some(k=>a[k]!==b[k]))fail('The original arguments changed while reading.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 }finally{await h.close();}
}
async function newOutput(path){
 if(!path)return;try{await lstat(resolve(path));fail('The output already exists. Inspect its retained original result before another call.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
async function output(value,path){
 const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(!path){process.stdout.write(raw);return value;}
 try{const h=await open(resolve(path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  process.stdout.write(JSON.stringify({saved:resolve(path),bytes:raw.length})+'\n');
 }catch(error){
  // Preserve the actual complete returned result even if its selected destination becomes unwritable.
  process.stdout.write(JSON.stringify({saved:false,output:resolve(path),error:{code:error.code??error.name,message:error.message},result:value})+'\n');
  process.exitCode=2;
 }
 return value;
}
export async function main(argv=process.argv.slice(2)){
 const [command,...rest]=argv;
 if(!command||['help','--help'].includes(command)){process.stdout.write(HELP);return;}
 if(command==='tools'){if(rest.length)fail('tools takes no options.');return output(propertyActions);}
 const shared=['--output'],remote=['--url','--workspace','--token-env'];let o,result,client;
 try{
  if(command==='call'){
   o=options(rest,[...shared,...remote,'--action','--arguments'],['--url','--action','--arguments']);await newOutput(o['--output']);
   const args=await argumentsFile(o['--arguments']);
   client=await openPropertyClient({url:o['--url'],workspace:o['--workspace'],tokenEnv:o['--token-env']});
   result=await client.call(o['--action'],args);
  }else if(command==='inspect'){
   o=options(rest,[...shared,...remote,'--export'],['--url','--workspace','--export']);await newOutput(o['--output']);
   result=await inspectPropertyExport({url:o['--url'],workspace:o['--workspace'],tokenEnv:o['--token-env'],exportId:o['--export']});
  }else if(command==='download'){
   o=options(rest,[...shared,...remote,'--export','--directory','--manifest-sha256','--chunk-size'],['--url','--workspace','--export','--directory']);await newOutput(o['--output']);
   if(o['--chunk-size']!==undefined&&!/^[1-9][0-9]*$/.test(o['--chunk-size']))fail('Use a positive integer chunk size.');
   result=await downloadPropertyExport({url:o['--url'],workspace:o['--workspace'],tokenEnv:o['--token-env'],
    exportId:o['--export'],directory:o['--directory'],expectedManifestSha256:o['--manifest-sha256'],
    ...(o['--chunk-size']===undefined?{}:{chunkSize:Number(o['--chunk-size'])})});
  }else if(command==='reopen'){
   o=options(rest,[...shared,'--export','--directory','--manifest-sha256'],['--export','--directory']);await newOutput(o['--output']);
   result=await reopenPropertyExport({directory:o['--directory'],exportId:o['--export'],expectedManifestSha256:o['--manifest-sha256']});
  }else fail('Choose tools, call, inspect, download or reopen.');
  return await output(result,o['--output']);
 }finally{if(client)await client.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,
  ...(error.details?{details:error.details}:{})})+'\n');process.exitCode=2;});
